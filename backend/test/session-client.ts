// Builds what a browser sends after signing in: both session cookies, the CSRF
// token echoed from its cookie, and the application's Origin.
import { publicOrigin } from '../src/lib/security-config';

export const origin = publicOrigin.origin;
export function cookiesFrom(response: Response): string {
  return response.headers.getSetCookie().map((cookie) => cookie.split(';')[0]).join('; ');
}
export function sessionHeaders(cookie: string): Record<string, string> {
  const csrf = cookie.split('; ').find((part) => part.startsWith('om-csrf='))?.slice(8) || '';
  return { cookie, origin, 'x-csrf-token': csrf };
}

/** The raw session identifier from a cookie header — what a stolen cookie would carry. */
export function sessionValue(cookie: string): string {
  return cookie.split('; ').find((part) => part.startsWith('om-session='))?.slice('om-session='.length) ?? '';
}
