// Google "Sign in with Google" — server-side Authorization Code flow.
//
// The browser is redirected to Google; Google calls us back with a short-lived
// `code`, which we exchange (server-to-server, using the client secret) for an
// ID token. We verify that ID token's signature against Google's public JWKS and
// then trust its claims (email, name, picture, hosted-domain).
//
// Config comes from the environment; if the client id/secret are absent the
// feature is simply disabled (isGoogleEnabled() === false).
import { createRemoteJWKSet, jwtVerify } from 'jose';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

// Lazily-built JWKS (cached + auto-rotated by jose).
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function getJwks() {
  if (!jwks) jwks = createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));
  return jwks;
}

export function googleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  // Optional Google Workspace domain (e.g. "richmond.local"), sent to Google only
  // as a hint to pre-select that domain on the consent screen. It grants nothing:
  // sign-in never creates accounts (see googleSignInDecision).
  const allowedDomain = process.env.GOOGLE_ALLOWED_DOMAIN?.trim().toLowerCase() || '';
  // The redirect URI must match one registered in the Google Cloud console.
  // Defaults to the public origin + /api/auth/google/callback (same origin as
  // the SPA behind nginx; the Vite dev proxy forwards /api in development).
  const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI?.trim() || `${frontendUrl}/api/auth/google/callback`;
  return { clientId, clientSecret, allowedDomain, redirectUri };
}

export function isGoogleEnabled(): boolean {
  const { clientId, clientSecret } = googleConfig();
  return Boolean(clientId && clientSecret);
}

// Build the Google consent-screen URL to redirect the browser to.
export function buildAuthUrl(state: string): string {
  const { clientId, redirectUri, allowedDomain } = googleConfig();
  const params = new URLSearchParams({
    client_id: clientId!,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    // Ask Google to pre-select / restrict to the org domain when we have one.
    ...(allowedDomain ? { hd: allowedDomain } : {}),
    prompt: 'select_account',
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

type TokenResponse = { id_token?: string; access_token?: string; error?: string; error_description?: string };

// Exchange the authorization `code` for tokens (server-to-server).
export async function exchangeCode(code: string): Promise<string> {
  const { clientId, clientSecret, redirectUri } = googleConfig();
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId!,
      client_secret: clientSecret!,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  const data = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !data.id_token) {
    throw new Error(data.error_description || data.error || 'Google token exchange failed');
  }
  return data.id_token;
}

export type GoogleProfile = {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
  picture: string | null;
  hd: string | null; // hosted (workspace) domain, if any
};

// Verify the ID token's signature + standard claims, then extract the profile.
export async function verifyIdToken(idToken: string): Promise<GoogleProfile> {
  const { clientId } = googleConfig();
  const { payload } = await jwtVerify(idToken, getJwks(), {
    issuer: GOOGLE_ISSUERS,
    audience: clientId!,
  });
  const email = String(payload.email || '').toLowerCase();
  if (!email) throw new Error('Google account has no email');
  return {
    sub: String(payload.sub),
    email,
    emailVerified: payload.email_verified === true,
    name: String(payload.name || email.split('@')[0]),
    picture: payload.picture ? String(payload.picture) : null,
    hd: payload.hd ? String(payload.hd).toLowerCase() : null,
  };
}
