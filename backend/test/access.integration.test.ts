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

    // The suite's main actor is a Platform Administrator. The Hotel Administrator
    // scoping tests below bring their own rh2 administrator and staff.
    await db.update(users).set({ platformAdmin: true }).where(eq(users.id, adminId));
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
  // ── Account lifecycle: Google-only creation, archive and restore, self guards ─
  const patchUser = (id: number, body: unknown) =>
    api(`/api/access/users/${id}`, { method: 'PATCH', headers: auth(), body: JSON.stringify(body) });
  const passwordLogin = (email: string, password: string) =>
    api('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ email, password }),
    });

  test('a new account is Google-only: no password is stored, even when one is sent', async () => {
    const googleOnly = `${USER_PREFIX}google-only@example.invalid`;
    const res = await api('/api/access/users', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ name: 'ZZ Google Only', email: googleOnly, password: 'changeme123' }),
    });
    expect(res.status).toBe(201);
    const [row] = await db.select().from(users).where(eq(users.email, googleOnly));
    expect(row.passwordHash).toBeNull();
    expect((await passwordLogin(googleOnly, 'changeme123')).status).toBe(401);
  });

  test('archiving replaces deletion: the account stays, its sessions end, and it cannot sign in until restored', async () => {
    const memberCookie = await login(MEMBER_EMAIL, PASSWORD);
    try {
      expect((await api(`/api/access/users/${memberId}`, { method: 'DELETE', headers: auth() })).status).toBe(200);
      const [archived] = await db.select().from(users).where(eq(users.id, memberId));
      expect(archived.status).toBe('archived');
      expect(archived.archivedAt).not.toBeNull();

      expect((await api('/api/auth/me', { headers: sessionHeaders(memberCookie) })).status).toBe(401);
      expect((await passwordLogin(MEMBER_EMAIL, PASSWORD)).status).toBe(403);

      // The email stays reserved, and an archived account cannot be edited or given access.
      const dupe = await api('/api/access/users', {
        method: 'POST',
        headers: auth(),
        body: JSON.stringify({ name: 'Someone New', email: MEMBER_EMAIL }),
      });
      expect(dupe.status).toBe(409);
      expect((await dupe.json()).error).toContain('Restore');
      expect((await patchUser(memberId, { title: 'ZZ' })).status).toBe(409);
      expect(
        (await api(`/api/access/users/${memberId}/assignments`, {
          method: 'PUT', headers: auth(), body: JSON.stringify({ assignments: [] }),
        })).status
      ).toBe(409);

      const restored = await api(`/api/access/users/${memberId}/restore`, { method: 'POST', headers: auth() });
      expect(restored.status).toBe(200);
      expect((await restored.json()).status).toBe('active');
      // Restoring does not revive the old session, but a fresh sign-in works.
      expect((await api('/api/auth/me', { headers: sessionHeaders(memberCookie) })).status).toBe(401);
      expect((await api('/api/auth/me', { headers: sessionHeaders(await login(MEMBER_EMAIL, PASSWORD)) })).status).toBe(200);

      expect((await api(`/api/access/users/${memberId}/restore`, { method: 'POST', headers: auth() })).status).toBe(409);
    } finally {
      await db.update(users).set({ status: 'active', archivedAt: null }).where(eq(users.id, memberId));
    }
  });

  test('archiving or restoring an account that does not exist is a 404', async () => {
    expect((await api(`/api/access/users/${GHOST_USER}`, { method: 'DELETE', headers: auth() })).status).toBe(404);
    expect((await api(`/api/access/users/${GHOST_USER}/restore`, { method: 'POST', headers: auth() })).status).toBe(404);
  });

  test('an administrator cannot suspend, archive or change the access of their own account', async () => {
    expect((await patchUser(adminId, { status: 'suspended' })).status).toBe(400);
    expect((await api(`/api/access/users/${adminId}`, { method: 'DELETE', headers: auth() })).status).toBe(400);
    expect(
      (await api(`/api/access/users/${adminId}/assignments`, {
        method: 'PUT', headers: auth(), body: JSON.stringify({ assignments: [] }),
      })).status
    ).toBe(400);
    expect(
      (await api(`/api/access/users/${adminId}/groups`, {
        method: 'PUT', headers: auth(), body: JSON.stringify({ groupIds: [] }),
      })).status
    ).toBe(400);

    const [self] = await db.select().from(users).where(eq(users.id, adminId));
    expect(self.status).toBe('active');
    expect((await db.select().from(assignments).where(eq(assignments.userId, adminId))).length).toBeGreaterThan(0);
  });
  test('an administrator cannot change the grant of a group they belong to, but may rename it', async () => {
    const res = await postGroup({ name: `${GROUP_PREFIX}-self`, roleId: 'viewer', hotelIds: ['rh2'], memberIds: [adminId] });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: number };
    const patch = (body: unknown) =>
      api(`/api/access/groups/${id}`, { method: 'PATCH', headers: auth(), body: JSON.stringify(body) });

    expect((await patch({ roleId: 'manager' })).status).toBe(400);
    expect((await patch({ hotelIds: ['rh2', 'rh3'] })).status).toBe(400);
    expect((await patch({ memberIds: [] })).status).toBe(400);
    expect((await patch({ name: `${GROUP_PREFIX}-self-renamed` })).status).toBe(200);
    expect((await api(`/api/access/groups/${id}`, { method: 'DELETE', headers: auth() })).status).toBe(400);
  });

  // ── Hotel Administrator scoping ─────────────────────────────────────────────
  describe('as a Hotel Administrator of rh2', () => {
    const HOTEL_ADMIN = `${USER_PREFIX}hotel-admin@example.invalid`;
    const RH2_STAFF = `${USER_PREFIX}rh2-staff@example.invalid`;
    const RH3_STAFF = `${USER_PREFIX}rh3-staff@example.invalid`;
    const BOTH_STAFF = `${USER_PREFIX}both-staff@example.invalid`;
    const ids: Record<string, number> = {};
    let hotelAdmin = '';
    const as = () => ({ ...sessionHeaders(hotelAdmin), 'content-type': 'application/json' });
    const getAs = async (path: string) => (await api(path, { headers: as() })).json();
    const send = (method: string, path: string, body?: unknown) =>
      api(path, { method, headers: as(), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

    beforeAll(async () => {
      const passwordHash = await bcrypt.hash(PASSWORD, 10);
      for (const email of [HOTEL_ADMIN, RH2_STAFF, RH3_STAFF, BOTH_STAFF]) {
        const [row] = await db.insert(users).values({ email, passwordHash, name: email, status: 'active' }).returning();
        ids[email] = row.id;
      }
      await db.insert(assignments).values([
        { userId: ids[HOTEL_ADMIN], hotelId: 'rh2', roleId: 'admin' },
        { userId: ids[RH2_STAFF], hotelId: 'rh2', roleId: 'viewer' },
        { userId: ids[RH3_STAFF], hotelId: 'rh3', roleId: 'viewer' },
        { userId: ids[BOTH_STAFF], hotelId: 'rh2', roleId: 'viewer' },
        { userId: ids[BOTH_STAFF], hotelId: 'rh3', roleId: 'manager' },
      ]);
      hotelAdmin = await login(HOTEL_ADMIN, PASSWORD);
    });

    test('sees only people connected to rh2, with only their rh2 assignments and access', async () => {
      const list = (await getAs('/api/access/users')) as {
        email: string;
        assignments: { hotelId: string; roleId: string }[];
        effective: Record<string, unknown>;
      }[];
      const emails = list.map((u) => u.email);
      expect(emails).toContain(RH2_STAFF);
      expect(emails).toContain(BOTH_STAFF);
      expect(emails).not.toContain(RH3_STAFF);

      const both = list.find((u) => u.email === BOTH_STAFF)!;
      expect(both.assignments).toEqual([{ hotelId: 'rh2', roleId: 'viewer' }]);
      expect(Object.keys(both.effective)).toEqual(['rh2']);

      // A Platform Administrator still sees everyone.
      const everyone = (await (await api('/api/access/users', { headers: auth() })).json()) as { email: string }[];
      expect(everyone.map((u) => u.email)).toContain(RH3_STAFF);
    });

    test('sees only rh2, groups lying wholly inside rh2, and which roles it may assign', async () => {
      expect(await getAs('/api/access/scope')).toEqual({ platform: false, readHotelIds: ['rh2'], crudHotelIds: ['rh2'] });
      expect(((await getAs('/api/access/hotels')) as { id: string }[]).map((h) => h.id)).toEqual(['rh2']);

      const groupList = (await getAs('/api/access/groups')) as { hotelIds: string[] }[];
      expect(groupList.every((gr) => gr.hotelIds.length > 0 && gr.hotelIds.every((h) => h === 'rh2'))).toBe(true);

      const roleList = (await getAs('/api/access/roles')) as { id: string; assignable: boolean }[];
      expect(roleList.find((r) => r.id === 'admin')?.assignable).toBe(false);
      expect(roleList.find((r) => r.id === 'viewer')?.assignable).toBe(true);
    });

    test('cannot create unassigned accounts, edit profiles, suspend, archive, restore or change roles', async () => {
      const staff = ids[RH2_STAFF];
      expect((await send('POST', '/api/access/users', { name: 'ZZ Nope', email: `${USER_PREFIX}nope@example.invalid` })).status).toBe(403);
      expect((await send('PATCH', `/api/access/users/${staff}`, { title: 'ZZ' })).status).toBe(403);
      expect((await send('PATCH', `/api/access/users/${staff}`, { status: 'suspended' })).status).toBe(403);
      expect((await send('DELETE', `/api/access/users/${staff}`)).status).toBe(403);
      expect((await send('POST', `/api/access/users/${staff}/restore`)).status).toBe(403);
      expect(
        (await send('POST', '/api/access/roles', {
          name: `${ROLE_PREFIX}-hotel`,
          perms: { devices: 'read', floors: 'read', cctv: 'read', userManagement: 'none' },
        })).status
      ).toBe(403);
    });

    test('adds a person to rh2 by exact email, creating a Google-only account only when a name is given', async () => {
      const attach = (body: Record<string, string>) => send('POST', '/api/access/users/attach', body);

      expect((await attach({ email: RH3_STAFF, hotelId: 'rh2', roleId: 'admin' })).status).toBe(403);
      expect((await attach({ email: RH3_STAFF, hotelId: 'rh3', roleId: 'viewer' })).status).toBe(403);
      expect((await attach({ email: RH3_STAFF, hotelId: 'rh2', roleId: 'viewer' })).status).toBe(200);
      const [grant] = await db
        .select()
        .from(assignments)
        .where(and(eq(assignments.userId, ids[RH3_STAFF]), eq(assignments.hotelId, 'rh2')));
      expect(grant.roleId).toBe('viewer');

      const newcomer = `${USER_PREFIX}newcomer@example.invalid`;
      expect((await attach({ email: newcomer, hotelId: 'rh2', roleId: 'viewer' })).status).toBe(404);
      expect((await attach({ email: newcomer, hotelId: 'rh2', roleId: 'viewer', name: 'ZZ Newcomer' })).status).toBe(201);
      const [row] = await db.select().from(users).where(eq(users.email, newcomer));
      expect(row.passwordHash).toBeNull();
      expect((await db.select().from(assignments).where(eq(assignments.userId, row.id))).map((a) => a.hotelId)).toEqual(['rh2']);
    });

    test('changes only rh2 assignments, keeps other hotels untouched, and never grants User Management', async () => {
      const both = ids[BOTH_STAFF];
      const put = (rows: { hotelId: string; roleId: string }[]) =>
        send('PUT', `/api/access/users/${both}/assignments`, { assignments: rows });

      expect((await put([{ hotelId: 'rh2', roleId: 'manager' }])).status).toBe(200);
      const rows = await db.select().from(assignments).where(eq(assignments.userId, both));
      expect(rows.map((r) => `${r.hotelId}:${r.roleId}`).sort()).toEqual(['rh2:manager', 'rh3:manager']);

      expect((await put([{ hotelId: 'rh2', roleId: 'manager' }, { hotelId: 'rh3', roleId: 'viewer' }])).status).toBe(403);
      expect((await put([{ hotelId: 'rh2', roleId: 'admin' }])).status).toBe(403);
    });

    test('someone connected only to other hotels is answered as not found', async () => {
      const [outsider] = await db
        .insert(users)
        .values({ email: `${USER_PREFIX}outsider@example.invalid`, name: 'ZZ Outsider', status: 'active' })
        .returning();
      await db.insert(assignments).values({ userId: outsider.id, hotelId: 'rh3', roleId: 'viewer' });

      expect((await send('PUT', `/api/access/users/${outsider.id}/assignments`, { assignments: [] })).status).toBe(404);
      expect((await send('PUT', `/api/access/users/${outsider.id}/groups`, { groupIds: [] })).status).toBe(404);
    });

    test('manages groups lying wholly inside rh2, but not groups reaching other hotels', async () => {
      const post = (body: unknown) => send('POST', '/api/access/groups', body);
      expect((await post({ name: `${GROUP_PREFIX}-scoped-wide`, roleId: 'viewer', hotelIds: ['rh2', 'rh3'], memberIds: [] })).status).toBe(403);
      expect((await post({ name: `${GROUP_PREFIX}-scoped-admin`, roleId: 'admin', hotelIds: ['rh2'], memberIds: [] })).status).toBe(403);

      const created = await post({ name: `${GROUP_PREFIX}-scoped`, roleId: 'viewer', hotelIds: ['rh2'], memberIds: [ids[RH2_STAFF]] });
      expect(created.status).toBe(201);
      const { id } = (await created.json()) as { id: number };
      expect((await send('PATCH', `/api/access/groups/${id}`, { name: `${GROUP_PREFIX}-scoped-renamed` })).status).toBe(200);

      // A group reaching rh3 is not this administrator's to see or change.
      const wide = await postGroup({ name: `${GROUP_PREFIX}-platform-wide`, roleId: 'viewer', hotelIds: ['rh2', 'rh3'], memberIds: [] });
      const { id: wideId } = (await wide.json()) as { id: number };
      expect((await send('PATCH', `/api/access/groups/${wideId}`, { name: 'ZZ' })).status).toBe(404);
      expect((await send('DELETE', `/api/access/groups/${wideId}`)).status).toBe(404);

      expect((await send('DELETE', `/api/access/groups/${id}`)).status).toBe(200);
    });
  });
});
