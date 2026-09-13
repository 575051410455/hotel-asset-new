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
import { db } from '../src/db';
import { users, groups, assignments, groupHotels, groupMembers } from '../src/db/schema';

const USER_PREFIX = 'zz-test-access-';
const GROUP_PREFIX = 'zz-test-access-grp';
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
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = (await res.json()) as { token?: string };
  if (!data.token) throw new Error(`login failed for ${email} (HTTP ${res.status})`);
  return data.token;
}

async function cleanup() {
  await db.delete(groups).where(like(groups.name, `${GROUP_PREFIX}%`));
  await db.delete(users).where(like(users.email, `${USER_PREFIX}%`));
}

const suite = reachable ? describe : describe.skip;

suite('access-control mutations (integration)', () => {
  let token = '';
  let adminId = 0;
  let memberId = 0;
  const auth = () => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });

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
});
