import { createMiddleware } from 'hono/factory';
import { jwtVerify } from 'jose';

const secret = new TextEncoder().encode(process.env.JWT_SECRET || 'default-secret');

// Access is per-property, so the token carries only the user id; the user's
// effective roles are resolved per request from the database.
export type AuthVariables = { userId: string };

export const authMiddleware = createMiddleware<{ Variables: AuthVariables }>(
  async (c, next) => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const token = authHeader.slice(7);
    try {
      const { payload } = await jwtVerify(token, secret);
      c.set('userId', payload.sub as string);
      await next();
    } catch {
      return c.json({ error: 'Invalid or expired token' }, 401);
    }
  }
);
