// Security-critical configuration, parsed once when the server starts. An
// invalid value stops the process before it binds a port, with an error that
// names the setting but never prints its value.

export type PublicOrigin = {
  /** e.g. "https://ops.example.com" — the only Origin state-changing requests may carry. */
  origin: string;
  /** Session cookies are Secure exactly when the public origin is HTTPS. */
  secureCookies: boolean;
};

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

// FRONTEND_URL is the origin the browser uses to reach the application. It
// decides which Origin state-changing requests must carry and whether the
// session cookies are Secure. It must be HTTPS except for local development:
// Cloudflare terminates TLS in front of us, and a session cookie must never
// travel over plain HTTP between machines.
export function parsePublicOrigin(value: string | undefined, nodeEnv: string | undefined): PublicOrigin {
  const raw = value?.trim();
  let url: URL | null = null;
  try {
    url = raw ? new URL(raw) : null;
  } catch {
    url = null;
  }
  if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:')) {
    throw new Error('FRONTEND_URL must be the absolute public origin of the application, e.g. https://ops.example.com');
  }
  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new Error('FRONTEND_URL must be an origin only, with no path, query or credentials');
  }
  if (url.protocol === 'http:' && (nodeEnv === 'production' || !LOCAL_HOSTS.has(url.hostname))) {
    throw new Error('FRONTEND_URL must use https, except for local development');
  }
  return { origin: url.origin, secureCookies: url.protocol === 'https:' };
}

export const publicOrigin = parsePublicOrigin(process.env.FRONTEND_URL, process.env.NODE_ENV);
