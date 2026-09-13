import { hc } from 'hono/client';
import type { ApiRoutes } from '@backend/app';

// Remove credentials left by the retired bearer-token client.
localStorage.removeItem('om-token');

// Typed Hono client. The deep route chain exceeds TS's conditional-type depth in
// build mode, so we cast through `any` while keeping runtime behavior intact.
const client = hc<ApiRoutes>('/', {
  fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const csrf = document.cookie.split('; ').find((cookie) => cookie.startsWith('om-csrf='))?.slice(8);
    if (csrf) headers.set('X-CSRF-Token', decodeURIComponent(csrf));

    const res = await fetch(input, { ...init, headers, credentials: 'same-origin' });

    if (res.status === 401) {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : (input as Request).url;
      // A failed login legitimately returns 401 — show the error, don't redirect.
      if (!url.includes('/auth/login')) {
        if (window.location.pathname !== '/login') window.location.href = '/login';
      }
    }
    return res;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}) as any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const api: any = client.api;

export async function hasSession(): Promise<boolean> {
  const response = await fetch('/api/auth/me', { credentials: 'same-origin' });
  return response.ok;
}

// Small helper: throw on non-2xx with the server's error message.
export async function unwrap<T = unknown>(res: Response): Promise<T> {
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = (data && (data.error || data.message)) || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}
