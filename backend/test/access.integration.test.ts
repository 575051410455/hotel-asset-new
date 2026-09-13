// Integration tests for the access-control mutations, driven through the real
// Hono app (app.fetch) against the configured Postgres. They create their OWN
// namespaced fixtures (`zz-test-access-*`) and HARD-delete them afterwards, so
// seeded demo data is never touched.
//
// These pin two behaviours that used to be wrong: a reference to something that
// doesn't exist reached Postgres as a foreign-key violation and surfaced as an
// unhandled 500, and the writes weren't atomic — a failed create still left a
// group row behind, and a failed assignment replace stripped the user's grants.
//
// The whole suite is skipped (not failed) when the database is unreachable, so
// the pure unit tests still run in an offline environment.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import bcrypt from 'bcryptjs';
import { and, eq, like } from 'drizzle-orm';
import app from '../src/app';
import { cookiesFrom, sessionHeaders, origin } from './session-client';
import { db } from '../src/db';
import { users, groups, assignments, groupHotels, groupMembers, roles } from '../src/db/schema';

const USER_PREFIX = 'zz-test-access-';
const GROUP_PREFIX = 'zz-test-access-grp';
const ROLE_PREFIX = 'zz-test-access-role';
const ADMIN_EMAIL = `${USER_PREFIX}admin@example.invalid`;
const MEMBER_EMAIL = `${USER_PREFIX}member@example.invalid`;
const PASSWORD = 'zz-test-Pa55word!';

// Ids that certainly do not exist, standing in for a property the UI still
// offers after it has gone away.
const GHOST_HOTEL = 'zz-no-such-hotel';
const GHOST_ROLE = 'zz-no-such-role';
const GHOST_USER = 99_999_999;

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
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login failed for ${email} (HTTP ${res.status})`);
  return cookiesFrom(res);
}

async function cleanup() {
  await db.delete(groups).where(like(groups.name, `${GROUP_PREFIX}%`));
  await db.delete(users).where(like(users.email, `${USER_PREFIX}%`));
  // After users: their assignments (which cascade with them) reference roles.
  await db.delete(roles).where(like(roles.name, `${ROLE_PREFIX}%`));
}

const suite = reachable ? describe : describe.skip;

suite('access-control mutations (integration)', () => {
  let token = '';
  let adminId = 0;
  let memberId = 0;
  const auth = () => ({ ...sessionHeaders(token), 'content-type': 'application/json' });

  const postGroup = (body: unknown) =>
    api('/api/access/groups', { method: 'POST', headers: auth(), body: JSON.stringify(body) });

  const countGroups = async () =>
    (await db.select({ id: groups.id }).from(groups).where(like(groups.name, `${GROUP_PREFIX}%`))).length;

  beforeAll(async () => {
    await cleanup();
    const passwordHash = await bcrypt.hash(PASSWORD, 10);

    const [admin] = await db
      .insert(users)
      .values({ email: ADMIN_EMAIL, passwordHash, name: 'ZZ Access Admin', status: 'active' })
      .returning();
    const [member] = await db
      .insert(users)
      .values({ email: MEMBER_EMAIL, passwordHash, name: 'ZZ Access Member', status: 'active' })
      .returning();
    adminId = admin.id;
    memberId = member.id;

    // Access management is gated on the highest `access` permission held on any
    // property, so one admin grant is enough.
    await db.insert(assignments).values({ userId: adminId, hotelId: 'rh2', roleId: 'admin' });
    token = await login(ADMIN_EMAIL, PASSWORD);
  });

  afterAll(cleanup);

  test('suspend then reactivate cannot resurrect an old session', async () => {
    const memberCookie = await login(MEMBER_EMAIL, PASSWORD);
    for (const status of ['suspended', 'active']) {
      const response = await api(`/api/access/users/${memberId}`, {
        method: 'PATCH', headers: auth(), body: JSON.stringify({ status }),
      });
      expect(response.status).toBe(200);
      expect((await api('/api/auth/me', { headers: sessionHeaders(memberCookie) })).status).toBe(401);
    }
    expect((await api('/api/auth/me', { headers: sessionHeaders(await login(MEMBER_EMAIL, PASSWORD)) })).status).toBe(200);
  });

  test('retired web reset never changes or discloses a password', async () => {
    const [before] = await db.select().from(users).where(eq(users.id, memberId));
    for (const body of [{}, { newPassword: 'attacker-selected-password' }]) {
      const response = await api(`/api/access/users/${memberId}/reset-password`, {
        method: 'POST', headers: auth(), body: JSON.stringify(body),
      });
      expect(response.status).toBe(410);
      expect(await response.json()).not.toHaveProperty('password');
    }
    const [after] = await db.select().from(users).where(eq(users.id, memberId));
    expect(after.passwordHash).toBe(before.passwordHash);
  });

  test('creating a group with a property that does not exist is a 400 naming it', async () => {
    const before = await countGroups();
    const res = await postGroup({
      name: `${GROUP_PREFIX}-ghost-hotel`,
      roleId: 'admin',
      hotelIds: [GHOST_HOTEL],
      memberIds: [],
    });

    expect(res.status).toBe(400);
    const { error } = await res.json();
    expect(error).toContain(GHOST_HOTEL);

    // and nothing was written — the bug left an empty group behind
    expect(await countGroups()).toBe(before);
  });

  test('creating a group with a role that does not exist is a 400 naming it', async () => {
    const before = await countGroups();
    const res = await postGroup({
      name: `${GROUP_PREFIX}-ghost-role`,
      roleId: GHOST_ROLE,
      hotelIds: ['rh2'],
      memberIds: [],
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain(GHOST_ROLE);
    expect(await countGroups()).toBe(before);
  });

  test('creating a group with a member that does not exist is a 400 naming it', async () => {
    const before = await countGroups();
    const res = await postGroup({
      name: `${GROUP_PREFIX}-ghost-member`,
      roleId: 'admin',
      hotelIds: ['rh2'],
      memberIds: [GHOST_USER],
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain(String(GHOST_USER));
    expect(await countGroups()).toBe(before);
  });

  test('a valid group is created with its properties and members attached', async () => {
    const res = await postGroup({
      name: `${GROUP_PREFIX}-valid`,
      roleId: 'viewer',
      hotelIds: ['rh2', 'rh3'],
      memberIds: [memberId],
    });
    expect(res.status).toBe(201);

    const created = await res.json();
    expect(created.name).toBe(`${GROUP_PREFIX}-valid`);
    expect(created.roleId).toBe('viewer');

    const hotelRows = await db.select().from(groupHotels).where(eq(groupHotels.groupId, created.id));
    expect(hotelRows.map((r) => r.hotelId).sort()).toEqual(['rh2', 'rh3']);

    const memberRows = await db.select().from(groupMembers).where(eq(groupMembers.groupId, created.id));
    expect(memberRows.map((r) => r.userId)).toEqual([memberId]);
  });

  test('a rejected assignment replace leaves the existing grants intact', async () => {
    // The member starts with one real grant.
    await db.delete(assignments).where(eq(assignments.userId, memberId));
    await db.insert(assignments).values({ userId: memberId, hotelId: 'rh2', roleId: 'viewer' });

    const res = await api(`/api/access/users/${memberId}/assignments`, {
      method: 'PUT',
      headers: auth(),
      body: JSON.stringify({ assignments: [{ hotelId: GHOST_HOTEL, roleId: 'viewer' }] }),
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain(GHOST_HOTEL);

    // The replace clears before it inserts, so a non-atomic failure would have
    // stripped every property this user could reach.
    const rows = await db
      .select()
      .from(assignments)
      .where(and(eq(assignments.userId, memberId), eq(assignments.hotelId, 'rh2')));
    expect(rows).toHaveLength(1);
    expect(rows[0].roleId).toBe('viewer');
  });

  test('a rejected membership replace leaves the existing memberships intact', async () => {
    const create = await postGroup({
      name: `${GROUP_PREFIX}-membership`,
      roleId: 'viewer',
      hotelIds: ['rh2'],
      memberIds: [memberId],
    });
    const group = await create.json();

    const res = await api(`/api/access/users/${memberId}/groups`, {
      method: 'PUT',
      headers: auth(),
      body: JSON.stringify({ groupIds: [99_999_999] }),
    });

    expect(res.status).toBe(400);

    const rows = await db.select().from(groupMembers).where(eq(groupMembers.userId, memberId));
    expect(rows.map((r) => r.groupId)).toContain(group.id);
  });

  // ── Permission rename overlap: legacy `access` and `userManagement` ─────────
  const postRole = (name: string, perms: Record<string, string>) =>
    api('/api/access/roles', { method: 'POST', headers: auth(), body: JSON.stringify({ name, perms }) });
  const storedPerms = async (id: string) =>
    (await db.select({ perms: roles.perms }).from(roles).where(eq(roles.id, id)))[0].perms;

  test('a role saved with the legacy access key is stored under both keys at the same level', async () => {
    const res = await postRole(`${ROLE_PREFIX}-legacy`, { devices: 'read', floors: 'read', cctv: 'none', access: 'read' });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    expect(await storedPerms(id)).toEqual({
      devices: 'read', floors: 'read', cctv: 'none', userManagement: 'read', access: 'read',
    });
  });

  test('a role saved with userManagement keeps the legacy mirror, and is listed with both', async () => {
    const res = await postRole(`${ROLE_PREFIX}-new`, { devices: 'none', floors: 'none', cctv: 'none', userManagement: 'crud' });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    expect(await storedPerms(id)).toMatchObject({ userManagement: 'crud', access: 'crud' });

    const listed = (await (await api('/api/access/roles', { headers: auth() })).json()) as {
      id: string;
      perms: Record<string, string>;
    }[];
    expect(listed.find((r) => r.id === id)?.perms).toMatchObject({ userManagement: 'crud', access: 'crud' });
  });

  test('a role whose userManagement and access values disagree is refused', async () => {
    const res = await postRole(`${ROLE_PREFIX}-conflict`, {
      devices: 'read', floors: 'read', cctv: 'read', userManagement: 'read', access: 'crud',
    });
    expect(res.status).toBe(400);
  });

  test('a stored role carrying neither key grants no User Management authority', async () => {
    const id = `${ROLE_PREFIX}-nokey`;
    await db.insert(roles).values({ id, name: id, perms: { devices: 'read', floors: 'read', cctv: 'read' } });
    await db.delete(assignments).where(eq(assignments.userId, memberId));
    await db.insert(assignments).values({ userId: memberId, hotelId: 'rh2', roleId: id });

    const headers = sessionHeaders(await login(MEMBER_EMAIL, PASSWORD));
    const hotels = (await (await api('/api/hotels', { headers })).json()) as {
      id: string;
      perms: Record<string, string>;
    }[];
    expect(hotels.find((h) => h.id === 'rh2')?.perms.userManagement).toBe('none');
    expect((await api('/api/access/users', { headers })).status).toBe(403);
  });
});
