import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { SignJWT } from 'jose';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { users } from '../db/schema';
import { loginSchema, changePasswordSchema, updateProfileSchema } from '../shared/types';
import { authMiddleware, type AuthVariables } from '../middleware/auth';
import { buildUserContext } from '../lib/session';

const secret = new TextEncoder().encode(process.env.JWT_SECRET || 'default-secret');

export const authRoutes = new Hono<{ Variables: AuthVariables }>();

// Public profile shape returned to the client (never the password hash).
function publicUser(u: typeof users.$inferSelect) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    phone: u.phone,
    title: u.title,
    department: u.department,
    status: u.status,
    lastLogin: u.lastLogin,
    createdAt: u.createdAt,
  };
}

// POST /api/auth/login
authRoutes.post('/login', zValidator('json', loginSchema), async (c) => {
  const { email, password } = c.req.valid('json');

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);

  if (!user) return c.json({ error: 'No account found for that email.' }, 401);

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return c.json({ error: 'Incorrect password. Try a demo account below.' }, 401);

  if (user.status !== 'active') {
    return c.json({ error: 'This account is suspended. Contact an administrator.' }, 403);
  }

  await db.update(users).set({ lastLogin: new Date() }).where(eq(users.id, user.id));

  const token = await new SignJWT({ sub: String(user.id) })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(secret);

  const ctx = await buildUserContext(user.id);

  return c.json({ token, user: publicUser(user), hotels: ctx.hotels });
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

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) return c.json({ error: 'Current password is incorrect' }, 400);

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
    return c.json({ ok: true });
  }
);
