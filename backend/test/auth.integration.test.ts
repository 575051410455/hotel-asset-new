// Integration tests for the hardened sign-in behaviour, driven through the real
// Hono app (app.fetch) against the configured Postgres. They create their OWN
// clearly-namespaced users (`zz-test-auth-*@example.invalid`) rather than lean
// on the seeded demo accounts, and HARD-delete them afterwards, so seeded demo
// data is never touched.
//
// The whole suite is skipped (not failed) when the database is unreachable, so
// the pure unit tests still run in an offline environment.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import bcrypt from 'bcryptjs';
import { like, eq } from 'drizzle-orm';
import app from '../src/app';
import { db } from '../src/db';
import { users, assignments } from '../src/db/schema';

const EMAIL_PREFIX = 'zz-test-auth-';
const email = (who: string) => `${EMAIL_PREFIX}${who}@example.invalid`;

const ACTIVE = email('active');
const SUSPENDED = email('suspended');
const GOOGLE = email('google');
const PASSWORD = 'zz-test-Pa55word!';
const TEST_HOTEL = 'rh2';

// Probe the DB once. If it can't be reached we skip rather than hang/fail.
let reachable = false;
if (process.env.DATABASE_URL) {
  const probe = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 3, onnotice: () => {} });
  try {
    await probe`select 1`;
    reachable = true;
  } catch {
    reachable = false;
  } finally {
    await probe.end({ timeout: 1 });
  }
}

const api = (path: string, init?: RequestInit) => app.fetch(new Request('http://localhost' + path, init));

const postLogin = (body: unknown) =>
  api('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

// Users cascade-delete their assignments, so removing the users is enough.
async function cleanup() {
  await db.delete(users).where(like(users.email, `${EMAIL_PREFIX}%`));
}

// describe.skip is universally available; pick it when the DB is down.
const suite = reachable ? describe : describe.skip;

suite('auth routes (integration)', () => {
  test('suspension invalidates an already issued token on protected routes', async () => {
    const login = await postLogin({ email: ACTIVE, password: PASSWORD });
    const { token } = await login.json();
    expect(typeof token).toBe('string');
    await db.update(users).set({ status: 'suspended' }).where(eq(users.email, ACTIVE));
    try {
      for (const path of ['/api/auth/me', '/api/hotels', '/api/devices?hotelId=rh2', '/api/floors?hotelId=rh2', '/api/access/users']) {
        expect((await api(path, { headers: { authorization: `Bearer ${token}` } })).status).toBe(401);
      }
    } finally {
      await db.update(users).set({ status: 'active' }).where(eq(users.email, ACTIVE));
    }
  });
  beforeAll(async () => {
    await cleanup();
    // Cost 10 — the same cost db:seed:admin uses.
    const passwordHash = await bcrypt.hash(PASSWORD, 10);

    const [active] = await db
      .insert(users)
      .values({ email: ACTIVE, passwordHash, name: 'ZZ Test Active', status: 'active' })
      .returning();
    await db.insert(users).values([
      { email: SUSPENDED, passwordHash, name: 'ZZ Test Suspended', status: 'suspended' },
      // Google-provisioned: no local password at all.
      { email: GOOGLE, passwordHash: null, name: 'ZZ Test Google', status: 'active' },
    ]);

    // Give the active user one accessible property so the login payload has
    // something to report.
    await db.insert(assignments).values({ userId: active.id, hotelId: TEST_HOTEL, roleId: 'viewer' });
  });

  afterAll(cleanup);

  test('an unknown email and a wrong password are indistinguishable', async () => {
    const unknown = await postLogin({ email: email('does-not-exist'), password: PASSWORD });
    const wrongPassword = await postLogin({ email: ACTIVE, password: 'definitely-not-the-password' });

    // The anti-enumeration guarantee: same status AND same body, so the
    // response can't be used to discover which addresses hold accounts.
    expect(unknown.status).toBe(401);
    expect(wrongPassword.status).toBe(unknown.status);
    expect(await wrongPassword.json()).toEqual(await unknown.json());
  });

  test('correct credentials return a token and the accessible properties', async () => {
    const res = await postLogin({ email: ACTIVE, password: PASSWORD });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(typeof body.token).toBe('string');
    expect(body.token.length).toBeGreaterThan(0);
    expect(body.user.email).toBe(ACTIVE);
    expect(body.user).not.toHaveProperty('passwordHash');
    expect(body.hotels.map((h: { id: string }) => h.id)).toEqual([TEST_HOTEL]);
    expect(body.hotels[0].roleId).toBe('viewer');

    // The token really works against a protected route.
    const me = await api('/api/auth/me', { headers: { authorization: `Bearer ${body.token}` } });
    expect(me.status).toBe(200);
    expect((await me.json()).user.email).toBe(ACTIVE);
  });

  test('a Google-provisioned account gets the Google message, not the generic one', async () => {
    const res = await postLogin({ email: GOOGLE, password: PASSWORD });
    expect(res.status).toBe(401);

    const { error } = await res.json();
    expect(error).toContain('Google');
    // Distinct from the generic credentials message.
    const generic = await (await postLogin({ email: ACTIVE, password: 'wrong' })).json();
    expect(error).not.toBe(generic.error);
  });

  test('a suspended account is refused at sign-in even with the right password', async () => {
    const res = await postLogin({ email: SUSPENDED, password: PASSWORD });
    expect(res.status).toBe(403);

    const body = await res.json();
    expect(body.error).toContain('suspended');
    expect(body.token).toBeUndefined(); // no session is issued
  });

  // Asserting `google === Boolean(CLIENT_ID && CLIENT_SECRET)` would just
  // recompute the implementation's own condition from the same environment and
  // pass even if the endpoint were inverted. Pin the actual expected value for
  // the environment instead, and state which environment that is.
  const googleConfigured = Boolean(
    process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim()
  );

  test.skipIf(googleConfigured)(
    'GET /api/auth/providers reports Google as unavailable when it is unconfigured',
    async () => {
      const res = await api('/api/auth/providers');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ google: false });
    }
  );

  test.skipIf(!googleConfigured)(
    'GET /api/auth/providers reports Google as available when it is configured',
    async () => {
      const res = await api('/api/auth/providers');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ google: true });
    }
  );

  test('a protected route rejects a missing or garbage bearer token', async () => {
    expect((await api('/api/auth/me')).status).toBe(401);

    const garbage = await api('/api/auth/me', { headers: { authorization: 'Bearer not.a.jwt' } });
    expect(garbage.status).toBe(401);

    // A non-Bearer scheme is rejected the same way.
    const wrongScheme = await api('/api/auth/me', { headers: { authorization: 'Basic abc123' } });
    expect(wrongScheme.status).toBe(401);
  });
});
