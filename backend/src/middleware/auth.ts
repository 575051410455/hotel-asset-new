import { createMiddleware } from 'hono/factory';
import { jwtVerify } from 'jose';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { users } from '../db/schema';
import { jwtSecret } from '../lib/security-config';


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
    let subject: string;
    try {
      const { payload } = await jwtVerify(token, jwtSecret, { algorithms: ['HS256'] });
      if (!payload.sub || !/^[1-9]\d*$/.test(payload.sub) ||
          !Number.isSafeInteger(Number(payload.sub)) || typeof payload.exp !== 'number') {
        return c.json({ error: 'Invalid or expired token' }, 401);
      }
      subject = payload.sub;
    } catch {
      return c.json({ error: 'Invalid or expired token' }, 401);
    }
    const [user] = await db.select({ status: users.status }).from(users)
      .where(eq(users.id, Number(subject))).limit(1);
    if (!user || user.status !== 'active') {
      return c.json({ error: 'Invalid or expired token' }, 401);
    }
    c.set('userId', subject);
    await next();
  }
);
