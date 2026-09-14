// Opaque, revocable server-side sessions (rollout phase 3 of
// docs/specs/security-hardening-and-user-management.md).
//
// The browser holds two cookies. `om-session` is the random session identifier:
// HttpOnly, and stored in the database only as a SHA-256 digest, so reading the
// sessions table cannot be replayed as a login. `om-csrf` is a second random
// value the page reads and echoes in the X-CSRF-Token header on writes; its
// digest is bound to the session, so a token from another session is refused.
// Both are SameSite=Strict, and Secure whenever the public origin is HTTPS.
//
// Every request re-checks the session against the current account, the idle
// timeout (30 minutes with User Management authority, 60 otherwise) and the
// 12-hour absolute limit.
import type { Context } from 'hono';
import { setCookie, deleteCookie } from 'hono/cookie';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { eq, isNull, and, sql } from 'drizzle-orm';
import { db } from '../db';
import { sessions, users } from '../db/schema';
import { publicOrigin } from './security-config';
import { getUserAccess, bestPermFor } from './rbac';

export const SESSION_COOKIE = 'om-session';
export const CSRF_COOKIE = 'om-csrf';

export const IDLE_TIMEOUT_MS = 60 * 60 * 1000;
export const PRIVILEGED_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
export const ABSOLUTE_TIMEOUT_MS = 12 * 60 * 60 * 1000;
// last_seen_at is written at most this often, so enforcement is precise to about a minute.
const TOUCH_INTERVAL_MS = 60 * 1000;

export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const sessionOrigin = () => publicOrigin.origin;
const options = () => ({
  path: '/',
  secure: publicOrigin.secureCookies,
  sameSite: 'Strict' as const,
  maxAge: ABSOLUTE_TIMEOUT_MS / 1000,
});

export async function issueSession(c: Context, userId: number, authMethod: 'password' | 'google') {
  const token = randomBytes(32).toString('hex');
  const csrf = randomBytes(32).toString('hex');
  await db.transaction(async (tx) => {
    // Serialize issuance with account suspension and password changes.
    const rows = await tx.execute<{ status: string }>(sql`select status from users where id = ${userId} for update`);
    if (rows[0]?.status !== 'active') throw new Error('Account is not active');
    await tx.insert(sessions).values({ userId, tokenHash: digest(token), csrfTokenHash: digest(csrf),
      authMethod, expiresAt: new Date(Date.now() + ABSOLUTE_TIMEOUT_MS),
      clientIp: c.req.header('x-real-ip')?.slice(0, 64),
      userAgent: c.req.header('user-agent')?.slice(0, 512) });
  });
  setCookie(c, SESSION_COOKIE, token, { ...options(), httpOnly: true });
  setCookie(c, CSRF_COOKIE, csrf, { ...options(), httpOnly: false });
  c.header('Cache-Control', 'no-store');
}

export function clearSessionCookies(c: Context) {
  deleteCookie(c, SESSION_COOKIE, options());
  deleteCookie(c, CSRF_COOKIE, options());
}

export async function revokeSession(sessionId: string, reason: string) {
  await db.update(sessions).set({ revokedAt: new Date(), revokedReason: reason })
    .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
}

export async function revokeUserSessions(userId: number, reason: string, tx: Pick<typeof db, 'update'> = db) {
  await tx.update(sessions).set({ revokedAt: new Date(), revokedReason: reason })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}

export type SessionFailure = 'no_session' | 'session_revoked' | 'session_expired';

export type ResolvedSession =
  | { ok: true; sessionId: string; userId: number; csrfTokenHash: string; lastSeenAt: Date }
  | { ok: false; code: SessionFailure; error: string };

const failure = (code: SessionFailure): ResolvedSession => ({
  ok: false,
  code,
  error: code === 'session_expired' ? 'Your session has expired. Please sign in again.' : 'Not signed in.',
});

// Whether the account can change User Management — such sessions get the shorter idle timeout.
async function hasUserManagementAuthority(userId: number, platformAdmin: boolean): Promise<boolean> {
  if (platformAdmin) return true;
  const { access, rolesById } = await getUserAccess(userId);
  return bestPermFor(access, rolesById, 'userManagement') === 'crud';
}

/** The live session behind a cookie value, or why there isn't one. A session found dead is revoked with the reason. */
export async function resolveSession(token: string): Promise<ResolvedSession> {
  const [row] = await db
    .select({
      id: sessions.id,
      userId: sessions.userId,
      csrfTokenHash: sessions.csrfTokenHash,
      lastSeenAt: sessions.lastSeenAt,
      expiresAt: sessions.expiresAt,
      revokedAt: sessions.revokedAt,
      status: users.status,
      platformAdmin: users.platformAdmin,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, digest(token)))
    .limit(1);

  if (!row) return failure('no_session');
  if (row.revokedAt) return failure('session_revoked');
  if (row.status !== 'active') {
    await revokeSession(row.id, 'account-status');
    return failure('session_revoked');
  }

  const now = Date.now();
  if (row.expiresAt.getTime() <= now) {
    await revokeSession(row.id, 'absolute-timeout');
    return failure('session_expired');
  }
  const idle = now - row.lastSeenAt.getTime();
  if (
    idle >= IDLE_TIMEOUT_MS ||
    (idle >= PRIVILEGED_IDLE_TIMEOUT_MS && (await hasUserManagementAuthority(row.userId, row.platformAdmin)))
  ) {
    await revokeSession(row.id, 'idle-timeout');
    return failure('session_expired');
  }

  return { ok: true, sessionId: row.id, userId: row.userId, csrfTokenHash: row.csrfTokenHash, lastSeenAt: row.lastSeenAt };
}

/** Whether a submitted CSRF token is the one bound to this session. */
export function csrfMatchesSession(header: string | undefined, csrfTokenHash: string): boolean {
  if (!header) return false;
  const given = Buffer.from(digest(header));
  const expected = Buffer.from(csrfTokenHash);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function touchSession(sessionId: string, lastSeenAt: Date) {
  if (Date.now() - lastSeenAt.getTime() < TOUCH_INTERVAL_MS) return;
  await db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, sessionId));
}
