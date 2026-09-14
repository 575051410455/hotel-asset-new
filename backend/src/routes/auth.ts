import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import bcrypt from 'bcryptjs';
import { and, eq, isNull } from 'drizzle-orm';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { db } from '../db';
import { users, sessions } from '../db/schema';
import { loginSchema, changePasswordSchema, updateProfileSchema } from '../shared/types';
import { authMiddleware, type AuthVariables } from '../middleware/auth';
import { buildUserContext } from '../lib/session';
import { issueSession, clearSessionCookies, revokeUserSessions, sessionOrigin } from '../lib/auth-session';
import { googleSignInDecision } from '../lib/google-identity';
import {
  isGoogleEnabled,
  googleConfig,
  buildAuthUrl,
  exchangeCode,
  verifyIdToken,
} from '../lib/google-oauth';

const OAUTH_STATE_COOKIE = 'om_oauth_state';

// The one message for every refused Google sign-in, so the response never
// reveals whether an account exists, is inactive, or is linked elsewhere.
const GOOGLE_REFUSED = "This Google account can't sign in to Ops Monitor. Ask IT Operations to set up your access.";

// A bcrypt hash of a discarded random string, compared against when the email
// doesn't exist so a failed lookup costs the same time as a failed password
// check. The comparison's result is thrown away — this can never authenticate
// anyone. Cost 10, matching db:seed:admin.
const DUMMY_HASH = '$2b$10$QZ.POmV1LCDUNIfwZEl5C.qOoZyUontyzyJSAy.aKxExhm65/oD8a';

export const authRoutes = new Hono<{ Variables: AuthVariables }>();

// Public profile shape returned to the client (never the password hash).
function publicUser(u: typeof users.$inferSelect) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    avatar: u.avatar,
    phone: u.phone,
    title: u.title,
    department: u.department,
    status: u.status,
    lastLogin: u.lastLogin,
    createdAt: u.createdAt,
  };
}


// GET /api/auth/providers — which sign-in methods the server offers.
authRoutes.get('/providers', (c) => c.json({ google: isGoogleEnabled() }));

// POST /api/auth/login
authRoutes.post('/login', zValidator('json', loginSchema), async (c) => {
  if (c.req.header('origin') !== sessionOrigin()) return c.json({ error: 'Invalid request origin' }, 403);
  const { email, password } = c.req.valid('json');

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);

  // One message for "no such email" AND "wrong password", so the response can't
  // be used to enumerate which addresses hold accounts.
  const BAD_CREDENTIALS = 'Incorrect email or password.';

  if (!user) {
    // Hash anyway: returning early here would make a missing account measurably
    // faster to reject than a wrong password, which leaks the same fact timing-wise.
    await bcrypt.compare(password, DUMMY_HASH);
    return c.json({ error: BAD_CREDENTIALS }, 401);
  }

  // Google-provisioned accounts have no local password.
  if (!user.passwordHash) {
    return c.json({ error: 'This account uses Google sign-in. Use “Continue with Google”.' }, 401);
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return c.json({ error: BAD_CREDENTIALS }, 401);

  if (user.status !== 'active') {
    return c.json({ error: 'This account is not active. Contact an administrator.' }, 403);
  }

  await db.update(users).set({ lastLogin: new Date() }).where(eq(users.id, user.id));

  await issueSession(c, user.id, 'password');
  const ctx = await buildUserContext(user.id);

  return c.json({ user: publicUser(user), hotels: ctx.hotels });
});

// ── Google OAuth (server-side Authorization Code flow) ───────────────────────

// GET /api/auth/google/start — kick off the redirect to Google's consent screen.
authRoutes.get('/google/start', (c) => {
  const { redirectUri } = googleConfig();
  const backTo = `${new URL(redirectUri).origin}/login`;
  if (!isGoogleEnabled()) {
    return c.redirect(`${backTo}#error=${encodeURIComponent('Google sign-in is not configured.')}`);
  }
  // CSRF: random state echoed back by Google and matched against an httpOnly cookie.
  const state = crypto.randomUUID();
  const secure = redirectUri.startsWith('https://');
  setCookie(c, OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'Lax',
    secure,
    path: '/api/auth',
    maxAge: 600,
  });
  return c.redirect(buildAuthUrl(state));
});

// GET /api/auth/google/callback — Google returns here with ?code & ?state.
authRoutes.get('/google/callback', async (c) => {
  const { redirectUri } = googleConfig();
  const backTo = `${new URL(redirectUri).origin}/login`;
  const fail = (msg: string) => c.redirect(`${backTo}#error=${encodeURIComponent(msg)}`);

  const url = new URL(c.req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthError = url.searchParams.get('error');

  const cookieState = getCookie(c, OAUTH_STATE_COOKIE);
  deleteCookie(c, OAUTH_STATE_COOKIE, { path: '/api/auth' });

  if (oauthError) return fail('Google sign-in was cancelled.');
  if (!code || !state || !cookieState || state !== cookieState) {
    return fail('Sign-in session expired. Please try again.');
  }

  let profile;
  try {
    const idToken = await exchangeCode(code);
    profile = await verifyIdToken(idToken);
  } catch (err) {
    console.error('Google callback error:', err);
    return fail('Could not verify your Google account. Please try again.');
  }

  // Sign-in never creates an account: it links only to one an administrator
  // prepared (see googleSignInDecision for the rule).
  const [bySubject] = await db.select().from(users).where(eq(users.googleSub, profile.sub)).limit(1);
  const [byEmail] = bySubject
    ? []
    : await db.select().from(users).where(eq(users.email, profile.email)).limit(1);
  const decision = googleSignInDecision(bySubject, byEmail, profile);
  if (!decision.ok) {
    console.warn(`Google sign-in refused: ${decision.reason}`);
    return fail(GOOGLE_REFUSED);
  }

  const account = (bySubject ?? byEmail)!;
  // Record the subject on first sign-in, guarded so a concurrent link of the
  // same account to another Google identity cannot both succeed.
  const [signedIn] = await db
    .update(users)
    .set({
      ...(decision.link ? { googleSub: profile.sub } : {}),
      avatar: account.avatar ?? profile.picture,
      lastLogin: new Date(),
    })
    .where(
      and(
        eq(users.id, decision.userId),
        decision.link ? isNull(users.googleSub) : eq(users.googleSub, profile.sub)
      )
    )
    .returning({ id: users.id });
  if (!signedIn) return fail(GOOGLE_REFUSED);

  try {
    await issueSession(c, signedIn.id, 'google');
  } catch {
    // The account stopped being Active between the check and the session.
    return fail(GOOGLE_REFUSED);
  }
  return c.redirect(`${backTo}#signed-in`);
});

authRoutes.post('/logout', authMiddleware, async (c) => {
  await db.update(sessions).set({ revokedAt: new Date(), revokedReason: 'logout' })
    .where(eq(sessions.id, c.get('sessionId')));
  clearSessionCookies(c);
  return c.json({ ok: true });
});

// GET /api/auth/me — current user + accessible hotels with effective perms
authRoutes.get('/me', authMiddleware, async (c) => {
  const userId = Number(c.get('userId'));
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return c.json({ error: 'User not found' }, 404);

  const ctx = await buildUserContext(userId);
  return c.json({ user: publicUser(user), hotels: ctx.hotels });
});

// PATCH /api/auth/me — update own profile
authRoutes.patch('/me', authMiddleware, zValidator('json', updateProfileSchema), async (c) => {
  const userId = Number(c.get('userId'));
  const patch = c.req.valid('json');
  const [updated] = await db
    .update(users)
    .set(patch)
    .where(eq(users.id, userId))
    .returning();
  if (!updated) return c.json({ error: 'User not found' }, 404);
  return c.json(publicUser(updated));
});

// POST /api/auth/change-password
authRoutes.post(
  '/change-password',
  authMiddleware,
  zValidator('json', changePasswordSchema),
  async (c) => {
    const userId = Number(c.get('userId'));
    const { currentPassword, newPassword } = c.req.valid('json');

    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) return c.json({ error: 'User not found' }, 404);

    // A Google-only account has no current password to verify against; it must
    // set one instead. Reject here so bcrypt.compare never sees a null hash.
    if (!user.passwordHash) {
      return c.json({ error: 'This account uses Google sign-in and has no password.' }, 400);
    }

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) return c.json({ error: 'Current password is incorrect' }, 400);

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await db.transaction(async (tx) => {
      await tx.update(users).set({ passwordHash }).where(eq(users.id, userId));
      await revokeUserSessions(userId, 'password-change', tx);
    });
    clearSessionCookies(c);
    return c.json({ ok: true });
  }
);
