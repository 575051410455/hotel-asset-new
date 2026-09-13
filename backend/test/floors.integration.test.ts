// Integration tests for the floor routes, driven through the real Hono app
// (app.fetch) against the configured Postgres. They use clearly-namespaced
// fixtures (slug `zz-test-*`, device `ZZ-TEST-*`, user `zz-test-floors-*`)
// under existing seeded hotels and HARD-delete them afterwards, so seeded demo
// data is never touched.
//
// The actors are created here rather than borrowed from the seeded demo
// accounts. Those accounts' grants drift — the demo "viewer" currently holds no
// property access at all — which made this suite fail on a correct application.
// Owning the fixtures means the suite asserts the permission model rather than
// the current state of the seed.
//
// The whole suite is skipped (not failed) when the database is unreachable, so
// the pure unit tests still run in an offline environment.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import bcrypt from 'bcryptjs';
import { and, eq, inArray, like } from 'drizzle-orm';
import app from '../src/app';
import { db } from '../src/db';
import { floors, devices, users, assignments, roles } from '../src/db/schema';

const SLUG_PREFIX = 'zz-test-';
const DEV_PREFIX = 'ZZ-TEST-';
const USER_PREFIX = 'zz-test-floors-';
const TEST_HOTELS = ['rh2', 'rh3'];

const ADMIN_EMAIL = `${USER_PREFIX}admin@example.invalid`;
const VIEWER_EMAIL = `${USER_PREFIX}viewer@example.invalid`;
const PASSWORD = 'zz-test-Pa55word!';

function registerRegressionSuite() {
describe('floor authorization regression fixture', () => {
  test.skipIf(!reachable)('omitted kind excludes CCTV floors and pins for a custom floor-only role', async () => {
    const roleId = 'zz-test-floor-only';
    const actorEmail = `${USER_PREFIX}floor-only@example.invalid`;
    const floorId = 'zz-test-private-cctv';
    try {
      await db.insert(roles).values({ id: roleId, name: 'Regression floor only',
        perms: { devices: 'none', floors: 'read', cctv: 'none', access: 'none' } });
      const [actor] = await db.insert(users).values({ email: actorEmail,
        name: 'Regression actor', passwordHash: await bcrypt.hash(PASSWORD, 10) }).returning();
      await db.insert(assignments).values({ userId: actor.id, hotelId: 'rh2', roleId });
      await db.insert(floors).values({ id: floorId, hotelId: 'rh2', name: 'Private CCTV',
        short: 'Private', kind: 'cctv', departments: [] });
      await db.insert(devices).values({ hotelId: 'rh2', floorId,
        computerName: 'ZZ-TEST-PRIVATE-CCTV', type: 'Camera', x: 10, y: 10, ip: '192.0.2.123' });
      const headers = authed(await login(actorEmail, PASSWORD));
      const omitted = await api('/api/floors?hotelId=rh2', { headers });
      expect(omitted.status).toBe(200);
      const body = await omitted.json();
      expect(body.every((floor: { kind: string }) => floor.kind === 'workstation')).toBe(true);
      expect(JSON.stringify(body)).not.toContain('192.0.2.123');
      expect((await api('/api/floors?hotelId=rh2&kind=cctv', { headers })).status).toBe(403);
    } finally {
      await db.delete(devices).where(eq(devices.computerName, 'ZZ-TEST-PRIVATE-CCTV'));
      await db.delete(floors).where(and(eq(floors.hotelId, 'rh2'), eq(floors.id, floorId)));
      await db.delete(users).where(eq(users.email, actorEmail));
      await db.delete(roles).where(eq(roles.id, roleId));
    }
  });
});

}

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
registerRegressionSuite();

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
  // Assignments cascade with the user rows.
  await db.delete(users).where(like(users.email, `${USER_PREFIX}%`));
}

// Create the two actors this suite needs: an admin with crud on both test
// properties, and a viewer with read on rh2 only.
async function createActors() {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  const [admin] = await db
    .insert(users)
    .values({ email: ADMIN_EMAIL, passwordHash, name: 'ZZ Test Floors Admin', status: 'active' })
    .returning();
  const [viewer] = await db
    .insert(users)
    .values({ email: VIEWER_EMAIL, passwordHash, name: 'ZZ Test Floors Viewer', status: 'active' })
    .returning();

  await db.insert(assignments).values([
    ...TEST_HOTELS.map((hotelId) => ({ userId: admin.id, hotelId, roleId: 'admin' })),
    { userId: viewer.id, hotelId: 'rh2', roleId: 'viewer' },
  ]);
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
    await cleanup(); // clear anything a previous interrupted run left behind
    await createActors();
    admin = await login(ADMIN_EMAIL, PASSWORD); // crud on rh2 + rh3
    viewer = await login(VIEWER_EMAIL, PASSWORD); // read on rh2 only
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

  // A floor's kind cannot be patched — updateFloorSchema does not accept it —
  // so delete-then-recreate is the ONLY way to correct a floor created with the
  // wrong kind, and the UI's guidance says exactly that. It works because the
  // revive path overwrites every field. If revival is ever changed to preserve
  // fields instead, that escape hatch disappears silently, so pin it here.
  test('reviving a soft-deleted slug replaces its kind, the only way to change one', async () => {
    const slug = `${SLUG_PREFIX}kind`;
    const create = await api('/api/floors', {
      method: 'POST',
      headers: authed(admin, { 'content-type': 'application/json' }),
      body: JSON.stringify(mkFloor({ id: slug, kind: 'workstation', short: 'ZZ Kind WS' })),
    });
    expect(create.status).toBe(201);
    expect((await create.json()).kind).toBe('workstation');

    // PATCH cannot touch it: the field is not in the update schema, so sending
    // it changes nothing rather than erroring.
    await api(`/api/floors/${slug}?hotelId=rh2`, {
      method: 'PATCH',
      headers: authed(admin, { 'content-type': 'application/json' }),
      body: JSON.stringify({ kind: 'cctv' }),
    });
    const afterPatch = await (await api('/api/floors?hotelId=rh2', { headers: authed(admin) })).json();
    expect(afterPatch.find((f: { id: string }) => f.id === slug).kind).toBe('workstation');

    // Delete and recreate with the same slug: the kind really does change.
    expect(
      (await api(`/api/floors/${slug}?hotelId=rh2`, { method: 'DELETE', headers: authed(admin) })).status
    ).toBe(200);

    const revived = await api('/api/floors', {
      method: 'POST',
      headers: authed(admin, { 'content-type': 'application/json' }),
      body: JSON.stringify(mkFloor({ id: slug, kind: 'cctv', short: 'ZZ Kind CCTV' })),
    });
    expect(revived.status).toBe(201);
    expect((await revived.json()).kind).toBe('cctv');
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

  // ── Pins are devices: click-to-place / drag-to-reposition / RBAC ────────────
  test('a pin (device) can be placed at %-coords and dragged, with reads blocked for viewers', async () => {
    // Add-at-click: POST a device with x/y onto the (revived) test floor.
    const create = await api('/api/devices', {
      method: 'POST',
      headers: authed(admin, { 'content-type': 'application/json' }),
      body: JSON.stringify({
        hotelId: 'rh2',
        floorId: `${SLUG_PREFIX}alpha`,
        computerName: `${DEV_PREFIX}PIN-1`,
        type: 'Desktop',
        status: 'active',
        x: 12.3,
        y: 45.6,
      }),
    });
    expect(create.status).toBe(201);
    const pin = await create.json();
    expect(pin.x).toBe(12.3);
    expect(pin.y).toBe(45.6);

    // Drag → %-persist: PATCH new coordinates.
    const moved = await api(`/api/devices/${pin.id}`, {
      method: 'PATCH',
      headers: authed(admin, { 'content-type': 'application/json' }),
      body: JSON.stringify({ x: 80.1, y: 20.9 }),
    });
    expect(moved.status).toBe(200);
    const after = await moved.json();
    expect(after.x).toBe(80.1);
    expect(after.y).toBe(20.9);

    // Read-only: a viewer cannot move or delete the pin.
    const viewerMove = await api(`/api/devices/${pin.id}`, {
      method: 'PATCH',
      headers: authed(viewer, { 'content-type': 'application/json' }),
      body: JSON.stringify({ x: 1, y: 1 }),
    });
    expect(viewerMove.status).toBe(403);

    const viewerDel = await api(`/api/devices/${pin.id}`, { method: 'DELETE', headers: authed(viewer) });
    expect(viewerDel.status).toBe(403);

    // Admin delete cleans the pin up.
    const adminDel = await api(`/api/devices/${pin.id}`, { method: 'DELETE', headers: authed(admin) });
    expect(adminDel.status).toBe(200);
  });
});
