import { createMiddleware } from 'hono/factory';
import { getCookie } from 'hono/cookie';
import {
  SESSION_COOKIE,
  resolveSession,
  csrfMatchesSession,
  touchSession,
  clearSessionCookies,
} from '../lib/auth-session';

// Every protected request resolves the opaque session cookie to one live
// session of an Active account before any route logic runs. State-changing
// requests must also carry the CSRF token bound to that session; their Origin
// is checked for every API request in app.ts. Bearer tokens are not accepted.
//
// Access is per-property, so the session carries only the user id; the user's
// effective roles are resolved per request from the database.
export type AuthVariables = { userId: string; sessionId: string };

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const authMiddleware = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return c.json({ error: 'Not signed in.', code: 'no_session' }, 401);

  const session = await resolveSession(token);
  if (!session.ok) {
    // Drop the dead cookies so the browser stops presenting them.
    clearSessionCookies(c);
    return c.json({ error: session.error, code: session.code }, 401);
  }

  if (!SAFE_METHODS.has(c.req.method) && !csrfMatchesSession(c.req.header('x-csrf-token'), session.csrfTokenHash)) {
    return c.json({ error: 'Missing or invalid CSRF token.' }, 403);
  }

  await touchSession(session.sessionId, session.lastSeenAt);
  c.set('userId', String(session.userId));
  c.set('sessionId', session.sessionId);
  await next();
});
