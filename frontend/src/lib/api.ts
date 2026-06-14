import { hc } from 'hono/client';
import type { ApiRoutes } from '@backend/app';

export const TOKEN_KEY = 'om-token';

// Typed Hono client. The deep route chain exceeds TS's conditional-type depth in
// build mode, so we cast through `any` while keeping runtime behavior intact.
const client = hc<ApiRoutes>('/', {
  fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
    const token = localStorage.getItem(TOKEN_KEY);
    const headers = new Headers(init?.headers);
    if (token) headers.set('Authorization', `Bearer ${token}`);

    const res = await fetch(input, { ...init, headers });

    if (res.status === 401) {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : (input as Request).url;
      // A failed login legitimately returns 401 — show the error, don't redirect.
      if (!url.includes('/auth/login')) {
        localStorage.removeItem(TOKEN_KEY);
        if (window.location.pathname !== '/login') window.location.href = '/login';
      }
    }
    return res;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}) as any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const api: any = client.api;

// Small helper: throw on non-2xx with the server's error message.
export async function unwrap<T = unknown>(res: Response): Promise<T> {
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = (data && (data.error || data.message)) || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}
