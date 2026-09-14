// Integration tests for sign-in and server-side sessions, driven through the
// real Hono app (app.fetch) against the configured Postgres. They create their
// OWN clearly-namespaced users (`zz-test-auth-*@example.invalid`) rather than
// lean on the seeded demo accounts, and HARD-delete them afterwards (sessions
// cascade with them), so seeded demo data is never touched.
//
// The whole suite is skipped (not failed) when the database is unreachable, so
// the pure unit tests still run in an offline environment.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import bcrypt from 'bcryptjs';
import { createHash } from 'node:crypto';
import { like, eq } from 'drizzle-orm';
import app from '../src/app';
import { db } from '../src/db';
import { users, assignments, sessions } from '../src/db/schema';
import { publicOrigin } from '../src/lib/security-config';
import { cookiesFrom, sessionHeaders, sessionValue, origin } from './session-client';

const EMAIL_PREFIX = 'zz-test-auth-';
const email = (who: string) => `${EMAIL_PREFIX}${who}@example.invalid`;

const ACTIVE = email('active');
const ADMIN = email('admin');
const SUSPENDED = email('suspended');
const GOOGLE = email('google');
const PASSWORD = 'zz-test-Pa55word!';
const TEST_HOTEL = 'rh2';

// Probe the DB once. If it can't be reached we skip rather than hang/fail.
let reachable = false;
if (process.env.DATABASE_URL) {
  const probe = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 3, onnotice: () => {} });
  try {
    await probe`select 1`;
    reachable = true;
  } catch {
    reachable = false;
  } finally {
    await probe.end({ timeout: 1 });
  }
}

const api = (path: string, init?: RequestInit) => app.fetch(new Request('http://localhost' + path, init));

const postLogin = (body: unknown, from: string | null = origin) =>
  api('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(from ? { origin: from } : {}) },
    body: JSON.stringify(body),
  });

async function signIn(who: string): Promise<string> {
  const res = await postLogin({ email: who, password: PASSWORD });
  if (!res.ok) throw new Error(`sign-in failed for ${who} (HTTP ${res.status})`);
  return cookiesFrom(res);
}

const me = (cookie: string) => api('/api/auth/me', { headers: sessionHeaders(cookie) });

const digest = (value: string) => createHash('sha256').update(value).digest('hex');

// Rewrite a session's clock in the database, as if time had passed.
const ageSession = (cookie: string, fields: { lastSeenAt?: Date; expiresAt?: Date }) =>
  db.update(sessions).set(fields).where(eq(sessions.tokenHash, digest(sessionValue(cookie))));

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

async function expectExpired(cookie: string) {
  const res = await me(cookie);
  expect(res.status).toBe(401);
  expect((await res.json()).code).toBe('session_expired');
}

// Users cascade-delete their assignments and sessions, so removing the users is enough.
async function cleanup() {
  await db.delete(users).where(like(users.email, `${EMAIL_PREFIX}%`));
}

// describe.skip is universally available; pick it when the DB is down.
const suite = reachable ? describe : describe.skip;

suite('auth routes and sessions (integration)', () => {
  let activeId = 0;
  let passwordHash = '';

  beforeAll(async () => {
    await cleanup();
    // Cost 10 — the same cost db:seed:admin uses.
    passwordHash = await bcrypt.hash(PASSWORD, 10);

    const [active] = await db
      .insert(users)
      .values({ email: ACTIVE, passwordHash, name: 'ZZ Test Active', status: 'active' })
      .returning();
    const [admin] = await db
      .insert(users)
      .values({ email: ADMIN, passwordHash, name: 'ZZ Test Admin', status: 'active' })
      .returning();
    await db.insert(users).values([
      { email: SUSPENDED, passwordHash, name: 'ZZ Test Suspended', status: 'suspended' },
      // Google-provisioned: no local password at all.
      { email: GOOGLE, passwordHash: null, name: 'ZZ Test Google', status: 'active' },
    ]);
    activeId = active.id;

    // A viewer (no User Management authority) and an administrator (with it).
    await db.insert(assignments).values([
      { userId: active.id, hotelId: TEST_HOTEL, roleId: 'viewer' },
      { userId: admin.id, hotelId: TEST_HOTEL, roleId: 'admin' },
    ]);
  });

  afterAll(cleanup);

  test('an unknown email and a wrong password are indistinguishable', async () => {
    const unknown = await postLogin({ email: email('does-not-exist'), password: PASSWORD });
    const wrongPassword = await postLogin({ email: ACTIVE, password: 'definitely-not-the-password' });

    // The anti-enumeration guarantee: same status AND same body, so the
    // response can't be used to discover which addresses hold accounts.
    expect(unknown.status).toBe(401);
    expect(wrongPassword.status).toBe(unknown.status);
    expect(await wrongPassword.json()).toEqual(await unknown.json());
  });

  test('sign-in sets an HttpOnly session cookie and a readable CSRF cookie, both SameSite=Strict, and returns no token', async () => {
    const res = await postLogin({ email: ACTIVE, password: PASSWORD });
    expect(res.status).toBe(200);

    const cookies = res.headers.getSetCookie();
    const session = cookies.find((c) => c.startsWith('om-session=')) ?? '';
    const csrf = cookies.find((c) => c.startsWith('om-csrf=')) ?? '';
    for (const cookie of [session, csrf]) {
      expect(cookie).toMatch(/SameSite=Strict/i);
      expect(cookie).toMatch(/Path=\//i);
      expect(/;\s*Secure/i.test(cookie)).toBe(publicOrigin.secureCookies);
    }
    expect(session).toMatch(/HttpOnly/i);
    expect(csrf).not.toMatch(/HttpOnly/i); // the page must be able to read it
    expect(res.headers.get('cache-control')).toBe('no-store');

    const body = await res.json();
    expect(body).not.toHaveProperty('token');
    expect(body.user.email).toBe(ACTIVE);
    expect(body.user).not.toHaveProperty('passwordHash');
    expect(body.hotels.map((h: { id: string }) => h.id)).toEqual([TEST_HOTEL]);
    expect(body.hotels[0].roleId).toBe('viewer');
  });

  test('the cookie authenticates, and the database keeps only a digest of it', async () => {
    const cookie = await signIn(ACTIVE);
    const res = await me(cookie);
    expect(res.status).toBe(200);
    expect((await res.json()).user.email).toBe(ACTIVE);

    const rows = await db.select({ tokenHash: sessions.tokenHash }).from(sessions).where(eq(sessions.userId, activeId));
    const hashes = rows.map((r) => r.tokenHash);
    expect(hashes).toContain(digest(sessionValue(cookie)));
    expect(hashes).not.toContain(sessionValue(cookie));
  });

  test('a bearer token, a missing cookie or a forged cookie is not a session', async () => {
    const cookie = await signIn(ACTIVE);
    expect((await api('/api/auth/me')).status).toBe(401);
    expect((await api('/api/auth/me', { headers: { authorization: `Bearer ${sessionValue(cookie)}` } })).status).toBe(401);
    expect((await api('/api/auth/me', { headers: { cookie: 'om-session=forged-value' } })).status).toBe(401);
  });

  test('state-changing requests need this session’s CSRF token and the application origin', async () => {
    const cookie = await signIn(ACTIVE);
    const otherSession = await signIn(ACTIVE);
    const patchMe = (headers: Record<string, string>) =>
      api('/api/auth/me', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ title: 'ZZ' }),
      });

    expect((await patchMe(sessionHeaders(cookie))).status).toBe(200);

    const { 'x-csrf-token': _csrf, ...noCsrf } = sessionHeaders(cookie);
    expect((await patchMe(noCsrf)).status).toBe(403);
    expect((await patchMe({ ...sessionHeaders(cookie), 'x-csrf-token': 'not-the-token' })).status).toBe(403);
    // A valid token from a different session is still refused: the token is bound to its session.
    expect((await patchMe({ ...sessionHeaders(cookie), 'x-csrf-token': sessionHeaders(otherSession)['x-csrf-token'] })).status).toBe(403);
    expect((await patchMe({ ...sessionHeaders(cookie), origin: 'https://evil.example' })).status).toBe(403);

    const { origin: _origin, ...noOrigin } = sessionHeaders(cookie);
    expect((await patchMe(noOrigin)).status).toBe(403);

    // Sign-in itself is refused from a foreign or missing origin.
    expect((await postLogin({ email: ACTIVE, password: PASSWORD }, 'https://evil.example')).status).toBe(403);
    expect((await postLogin({ email: ACTIVE, password: PASSWORD }, null)).status).toBe(403);
  });

  test('logout revokes the session on the server, so a copied cookie stops working', async () => {
    const cookie = await signIn(ACTIVE);
    const res = await api('/api/auth/logout', { method: 'POST', headers: sessionHeaders(cookie) });
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie().some((c) => /^om-session=;/.test(c))).toBe(true);

    expect((await me(cookie)).status).toBe(401);
  });

  test('a suspension made outside the API is enforced, and reactivation does not revive the session', async () => {
    const cookie = await signIn(ACTIVE);
    await db.update(users).set({ status: 'suspended' }).where(eq(users.id, activeId));
    try {
      for (const path of ['/api/auth/me', '/api/hotels', '/api/devices?hotelId=rh2', '/api/floors?hotelId=rh2']) {
        expect((await api(path, { headers: sessionHeaders(cookie) })).status).toBe(401);
      }
    } finally {
      await db.update(users).set({ status: 'active' }).where(eq(users.id, activeId));
    }
    expect((await me(cookie)).status).toBe(401);
    expect((await me(await signIn(ACTIVE))).status).toBe(200);
  });

  test('a session ends after 60 idle minutes, and stays alive inside that window', async () => {
    const kept = await signIn(ACTIVE);
    await ageSession(kept, { lastSeenAt: minutesAgo(45) });
    expect((await me(kept)).status).toBe(200);

    const idle = await signIn(ACTIVE);
    await ageSession(idle, { lastSeenAt: minutesAgo(61) });
    await expectExpired(idle);
  });

  test('a session with User Management authority ends after 30 idle minutes', async () => {
    const admin = await signIn(ADMIN);
    await ageSession(admin, { lastSeenAt: minutesAgo(35) });
    await expectExpired(admin);
  });

  test('no session outlives its 12-hour absolute limit, however active', async () => {
    const cookie = await signIn(ACTIVE);
    await ageSession(cookie, { expiresAt: new Date(Date.now() - 1000) });
    await expectExpired(cookie);
  });

  test('changing the password ends every session of the account, including the current one', async () => {
    const current = await signIn(ACTIVE);
    const other = await signIn(ACTIVE);
    try {
      const res = await api('/api/auth/change-password', {
        method: 'POST',
        headers: { ...sessionHeaders(current), 'content-type': 'application/json' },
        body: JSON.stringify({ currentPassword: PASSWORD, newPassword: 'zz-test-N3wPassword!' }),
      });
      expect(res.status).toBe(200);
      expect((await me(current)).status).toBe(401);
      expect((await me(other)).status).toBe(401);
    } finally {
      await db.update(users).set({ passwordHash }).where(eq(users.id, activeId));
    }
  });

  test('a Google-provisioned account gets the Google message, not the generic one', async () => {
    const res = await postLogin({ email: GOOGLE, password: PASSWORD });
    expect(res.status).toBe(401);

    const { error } = await res.json();
    expect(error).toContain('Google');
    // Distinct from the generic credentials message.
    const generic = await (await postLogin({ email: ACTIVE, password: 'wrong' })).json();
    expect(error).not.toBe(generic.error);
  });

  test('a suspended account is refused at sign-in even with the right password', async () => {
    const res = await postLogin({ email: SUSPENDED, password: PASSWORD });
    expect(res.status).toBe(403);

    const body = await res.json();
    expect(body.error).toContain('not active');
    expect(res.headers.getSetCookie()).toEqual([]); // no session is issued
  });

  // Asserting `google === Boolean(CLIENT_ID && CLIENT_SECRET)` would just
  // recompute the implementation's own condition from the same environment and
  // pass even if the endpoint were inverted. Pin the actual expected value for
  // the environment instead, and state which environment that is.
  const googleConfigured = Boolean(
    process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim()
  );

  test.skipIf(googleConfigured)(
    'GET /api/auth/providers reports Google as unavailable when it is unconfigured',
    async () => {
      const res = await api('/api/auth/providers');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ google: false });
    }
  );

  test.skipIf(!googleConfigured)(
    'GET /api/auth/providers reports Google as available when it is configured',
    async () => {
      const res = await api('/api/auth/providers');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ google: true });
    }
  );
});
