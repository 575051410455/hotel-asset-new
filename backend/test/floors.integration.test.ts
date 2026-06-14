// Integration tests for the floor routes, driven through the real Hono app
// (app.fetch) against the configured Postgres. They use clearly-namespaced
// fixtures (slug `zz-test-*`, device `ZZ-TEST-*`) under existing seeded hotels
// and HARD-delete them afterwards, so seeded demo data is never touched.
//
// The whole suite is skipped (not failed) when the database is unreachable, so
// the pure unit tests still run in an offline environment.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { and, eq, inArray, like } from 'drizzle-orm';
import app from '../src/app';
import { db } from '../src/db';
import { floors, devices } from '../src/db/schema';

const SLUG_PREFIX = 'zz-test-';
const DEV_PREFIX = 'ZZ-TEST-';
const TEST_HOTELS = ['rh2', 'rh3'];

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

async function login(email: string, password: string): Promise<string> {
  const res = await api('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = (await res.json()) as { token?: string };
  if (!data.token) throw new Error(`login failed for ${email} (HTTP ${res.status})`);
  return data.token;
}

const authed = (token: string, extra: Record<string, string> = {}) => ({
  authorization: `Bearer ${token}`,
  ...extra,
});

async function cleanup() {
  await db
    .delete(devices)
    .where(and(inArray(devices.hotelId, TEST_HOTELS), like(devices.computerName, `${DEV_PREFIX}%`)));
  await db
    .delete(floors)
    .where(and(inArray(floors.hotelId, TEST_HOTELS), like(floors.id, `${SLUG_PREFIX}%`)));
}

// describe.skip is universally available; pick it when the DB is down.
const suite = reachable ? describe : describe.skip;

suite('floors routes (integration)', () => {
  let admin = '';
  let viewer = '';

  const mkFloor = (over: Record<string, unknown> = {}) => ({
    hotelId: 'rh2',
    id: `${SLUG_PREFIX}alpha`,
    name: 'ZZ Test Alpha',
    short: 'ZZ Alpha',
    kind: 'workstation',
    departments: ['One', 'Two'],
    ...over,
  });

  beforeAll(async () => {
    admin = await login('chai@richmond.local', 'admin123'); // admin on all properties
    viewer = await login('gift@richmond.local', 'user123'); // viewer on rh2
    await cleanup();
  });
  afterAll(cleanup);

  test('rejects unauthenticated reads (401)', async () => {
    expect((await api('/api/floors?hotelId=rh2')).status).toBe(401);
  });

  test('admin creates a floor; it appears only in its own property', async () => {
    const res = await api('/api/floors', {
      method: 'POST',
      headers: authed(admin, { 'content-type': 'application/json' }),
      body: JSON.stringify(mkFloor()),
    });
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.id).toBe(`${SLUG_PREFIX}alpha`);
    expect(created.route).toBe(`/${SLUG_PREFIX}alpha`); // defaulted from the slug
    expect(created.pins).toEqual([]);

    const rh2 = await (await api('/api/floors?hotelId=rh2', { headers: authed(admin) })).json();
    expect(rh2.some((f: { id: string }) => f.id === `${SLUG_PREFIX}alpha`)).toBe(true);

    const rh3 = await (await api('/api/floors?hotelId=rh3', { headers: authed(admin) })).json();
    expect(rh3.some((f: { id: string }) => f.id === `${SLUG_PREFIX}alpha`)).toBe(false);
  });

  test('rejects a duplicate slug within the same property (409)', async () => {
    const res = await api('/api/floors', {
      method: 'POST',
      headers: authed(admin, { 'content-type': 'application/json' }),
      body: JSON.stringify(mkFloor()),
    });
    expect(res.status).toBe(409);
  });

  test('allows the same slug under a different property (composite key)', async () => {
    const res = await api('/api/floors', {
      method: 'POST',
      headers: authed(admin, { 'content-type': 'application/json' }),
      body: JSON.stringify(mkFloor({ hotelId: 'rh3' })),
    });
    expect(res.status).toBe(201);
  });

  test('rejects an invalid slug at the schema boundary (400)', async () => {
    const res = await api('/api/floors', {
      method: 'POST',
      headers: authed(admin, { 'content-type': 'application/json' }),
      body: JSON.stringify(mkFloor({ id: 'NOT VALID' })),
    });
    expect(res.status).toBe(400);
  });

  test('PATCH renames a floor', async () => {
    const res = await api(`/api/floors/${SLUG_PREFIX}alpha?hotelId=rh2`, {
      method: 'PATCH',
      headers: authed(admin, { 'content-type': 'application/json' }),
      body: JSON.stringify({ short: 'ZZ Renamed' }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).short).toBe('ZZ Renamed');
  });

  test('DELETE soft-deletes, detaches pins, and the slug can then be revived', async () => {
    // Pin a device onto the floor.
    const devRes = await api('/api/devices', {
      method: 'POST',
      headers: authed(admin, { 'content-type': 'application/json' }),
      body: JSON.stringify({
        hotelId: 'rh2',
        floorId: `${SLUG_PREFIX}alpha`,
        computerName: `${DEV_PREFIX}DEV-1`,
        type: 'Desktop',
        status: 'active',
        x: 40,
        y: 55,
      }),
    });
    expect(devRes.status).toBe(201);
    const devId = (await devRes.json()).id as number;

    const del = await api(`/api/floors/${SLUG_PREFIX}alpha?hotelId=rh2`, {
      method: 'DELETE',
      headers: authed(admin),
    });
    expect(del.status).toBe(200);

    // No longer listed.
    const list = await (await api('/api/floors?hotelId=rh2', { headers: authed(admin) })).json();
    expect(list.some((f: { id: string }) => f.id === `${SLUG_PREFIX}alpha`)).toBe(false);

    // Device survives but its floor link + placement are cleared.
    const [detached] = await db.select().from(devices).where(eq(devices.id, devId));
    expect(detached.floorId).toBeNull();
    expect(detached.x).toBeNull();
    expect(detached.y).toBeNull();

    // Re-creating the same slug revives the soft-deleted row.
    const revive = await api('/api/floors', {
      method: 'POST',
      headers: authed(admin, { 'content-type': 'application/json' }),
      body: JSON.stringify(mkFloor({ short: 'ZZ Revived' })),
    });
    expect(revive.status).toBe(201);
    expect((await revive.json()).short).toBe('ZZ Revived');
  });

  test('a viewer can read floors but not create / patch / delete', async () => {
    expect((await api('/api/floors?hotelId=rh2', { headers: authed(viewer) })).status).toBe(200);

    const create = await api('/api/floors', {
      method: 'POST',
      headers: authed(viewer, { 'content-type': 'application/json' }),
      body: JSON.stringify(mkFloor({ id: `${SLUG_PREFIX}viewer` })),
    });
    expect(create.status).toBe(403);

    const patch = await api(`/api/floors/${SLUG_PREFIX}alpha?hotelId=rh2`, {
      method: 'PATCH',
      headers: authed(viewer, { 'content-type': 'application/json' }),
      body: JSON.stringify({ short: 'nope' }),
    });
    expect(patch.status).toBe(403);

    const del = await api(`/api/floors/${SLUG_PREFIX}alpha?hotelId=rh2`, {
      method: 'DELETE',
      headers: authed(viewer),
    });
    expect(del.status).toBe(403);
  });

  test('PATCH / DELETE on a missing floor returns 404 (not 500)', async () => {
    const patch = await api(`/api/floors/${SLUG_PREFIX}ghost?hotelId=rh2`, {
      method: 'PATCH',
      headers: authed(admin, { 'content-type': 'application/json' }),
      body: JSON.stringify({ short: 'x' }),
    });
    expect(patch.status).toBe(404);

    const del = await api(`/api/floors/${SLUG_PREFIX}ghost?hotelId=rh2`, {
      method: 'DELETE',
      headers: authed(admin),
    });
    expect(del.status).toBe(404);
  });
});
