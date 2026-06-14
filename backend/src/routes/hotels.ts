import { Hono } from 'hono';
import { authMiddleware, type AuthVariables } from '../middleware/auth';
import { buildUserContext } from '../lib/session';

export const hotelRoutes = new Hono<{ Variables: AuthVariables }>();

// GET /api/hotels — hotels the signed-in user can access, with their role/perms.
hotelRoutes.get('/', authMiddleware, async (c) => {
  const userId = Number(c.get('userId'));
  const ctx = await buildUserContext(userId);
  return c.json(ctx.hotels);
});
