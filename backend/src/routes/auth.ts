import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { SignJWT } from 'jose';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { db } from '../db';
import { users } from '../db/schema';
import { loginSchema, changePasswordSchema, updateProfileSchema } from '../shared/types';
import { authMiddleware, type AuthVariables } from '../middleware/auth';
import { buildUserContext } from '../lib/session';
import {
  isGoogleEnabled,
  googleConfig,
  buildAuthUrl,
  exchangeCode,
  verifyIdToken,
} from '../lib/google-oauth';

const secret = new TextEncoder().encode(process.env.JWT_SECRET || 'default-secret');
const OAUTH_STATE_COOKIE = 'om_oauth_state';

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

// Sign a 24h HS256 session token for a user id.
function signSession(userId: number): Promise<string> {
  return new SignJWT({ sub: String(userId) })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(secret);
}

// GET /api/auth/providers — which sign-in methods the server offers.
authRoutes.get('/providers', (c) => c.json({ google: isGoogleEnabled() }));

// POST /api/auth/login
authRoutes.post('/login', zValidator('json', loginSchema), async (c) => {
  const { email, password } = c.req.valid('json');

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);

  if (!user) return c.json({ error: 'No account found for that email.' }, 401);

  // Google-provisioned accounts have no local password.
  if (!user.passwordHash) {
    return c.json({ error: 'This account uses Google sign-in. Use “Continue with Google”.' }, 401);
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return c.json({ error: 'Incorrect password. Try a demo account below.' }, 401);

  if (user.status !== 'active') {
    return c.json({ error: 'This account is suspended. Contact an administrator.' }, 403);
  }

  await db.update(users).set({ lastLogin: new Date() }).where(eq(users.id, user.id));

  const token = await signSession(user.id);
  const ctx = await buildUserContext(user.id);

  return c.json({ token, user: publicUser(user), hotels: ctx.hotels });
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
  const { redirectUri, allowedDomain } = googleConfig();
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

  if (!profile.emailVerified) return fail('Your Google email is not verified.');

  // Domain gate: only auto-provision (and only admit) emails on the allowed
  // domain. Without a configured domain we admit only pre-existing accounts.
  const emailDomain = profile.email.split('@')[1] || '';
  const domainOk = allowedDomain
    ? profile.hd === allowedDomain || emailDomain === allowedDomain
    : false;

  // Find by Google subject first, then by email (links an existing local user).
  let [user] = await db.select().from(users).where(eq(users.googleSub, profile.sub)).limit(1);
  if (!user) {
    [user] = await db.select().from(users).where(eq(users.email, profile.email)).limit(1);
  }

  if (!user) {
    if (!domainOk) {
      return fail('No account for that email. Ask IT Operations for access.');
    }
    [user] = await db
      .insert(users)
      .values({
        email: profile.email,
        passwordHash: null,
        googleSub: profile.sub,
        avatar: profile.picture,
        name: profile.name,
        status: 'active',
        lastLogin: new Date(),
      })
      .returning();
  } else {
    if (user.status !== 'active') {
      return fail('This account is suspended. Contact an administrator.');
    }
    // Link the Google identity + refresh avatar/last-login on the existing user.
    await db
      .update(users)
      .set({
        googleSub: user.googleSub ?? profile.sub,
        avatar: user.avatar ?? profile.picture,
        lastLogin: new Date(),
      })
      .where(eq(users.id, user.id));
  }

  const token = await signSession(user.id);
  // Deliver the token in the URL fragment (never sent to servers / not logged).
  return c.redirect(`${backTo}#token=${encodeURIComponent(token)}`);
});

// POST /api/auth/logout (stateless — client drops the token)
authRoutes.post('/logout', (c) => c.json({ ok: true }));

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
    await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
    return c.json({ ok: true });
  }
);
