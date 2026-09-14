import { Hono, type Context } from 'hono';
import { and, eq, inArray } from 'drizzle-orm';
import { zValidator } from '@hono/zod-validator';
import { db } from '../db';
import {
  users,
  roles,
  groups,
  groupHotels,
  groupMembers,
  assignments,
  hotels,
} from '../db/schema';
import {
  createUserSchema,
  attachUserSchema,
  updateUserSchema,
  resetPasswordSchema,
  assignmentsSchema,
  membershipSchema,
  createRoleSchema,
  updateRoleSchema,
  createGroupSchema,
  updateGroupSchema,
} from '../shared/types';
import { authMiddleware, type AuthVariables } from '../middleware/auth';
import { computeEffectiveAccess } from '../lib/rbac';
import { revokeUserSessions } from '../lib/auth-session';
import { assertPlatformAdminRemains, lockAccountLifecycle, LifecycleRefusal } from '../lib/account-lifecycle';
import { normalizeRolePerms, withLegacyAccessKey } from '../lib/permissions';
import {
  loadManagementScope,
  canReadUserManagement,
  canWriteUserManagement,
  hotelInScope,
  hotelsWithin,
  roleAssignable,
  userVisible,
  groupVisible,
  groupManageable,
} from '../lib/user-management-scope';

export const accessRoutes = new Hono<{ Variables: AuthVariables }>();

// Who may do what here (docs/specs/security-hardening-and-user-management.md,
// "User Management rename and authorization"). Every rule is enforced on the
// server; the page only mirrors it, reading GET /scope.
//
// - A Platform Administrator (users.platform_admin) manages every account, role,
//   group and hotel, and alone creates unassigned accounts, edits profiles,
//   suspends, archives and restores, and changes roles.
// - A Hotel Administrator holds User Management CRUD on particular hotels. They
//   see only people connected to those hotels, only those hotels' assignments,
//   and only groups lying wholly inside them. They add a person to their hotel by
//   exact email (creating a Google-only account when needed), change their
//   hotels' assignments and groups, and assign any role that does not itself
//   carry User Management CRUD.
// - User Management READ on a hotel gives the same view without changes.
//
// Something outside the caller's view is answered as not found, so the answer
// does not reveal that it exists.

const PLATFORM_ONLY = 'Only a Platform Administrator can do this.';
const OUTSIDE_SCOPE = 'That is outside the hotels you administer.';
const NOT_ASSIGNABLE = 'Only a Platform Administrator can grant User Management authority.';
const ATTACH_FIRST = 'Add people to your hotel by email before putting them in a group.';

// Check that every id the caller referenced actually exists, BEFORE writing
// anything. Without this a bad id reaches Postgres as a foreign-key violation,
// which escapes as an unhandled 500 — a dead end for a caller who only picked a
// property that no longer exists. Returns one message per problem, or [] if all
// the references resolve.
async function missingRefs(refs: {
  hotelIds?: string[];
  roleIds?: string[];
  userIds?: number[];
  groupIds?: number[];
}): Promise<string[]> {
  const problems: string[] = [];

  const check = async <T extends string | number>(
    ids: T[] | undefined,
    load: (unique: T[]) => Promise<T[]>,
    label: string
  ) => {
    const unique = [...new Set(ids ?? [])];
    if (!unique.length) return;
    const found = new Set(await load(unique));
    const missing = unique.filter((id) => !found.has(id));
    if (missing.length) {
      problems.push(`Unknown ${label}: ${missing.join(', ')}.`);
    }
  };

  await check(
    refs.hotelIds,
    async (ids) => (await db.select({ id: hotels.id }).from(hotels).where(inArray(hotels.id, ids))).map((r) => r.id),
    'property'
  );
  await check(
    refs.roleIds,
    async (ids) => (await db.select({ id: roles.id }).from(roles).where(inArray(roles.id, ids))).map((r) => r.id),
    'role'
  );
  await check(
    refs.userIds,
    async (ids) => (await db.select({ id: users.id }).from(users).where(inArray(users.id, ids))).map((r) => r.id),
    'user'
  );
  await check(
    refs.groupIds,
    async (ids) => (await db.select({ id: groups.id }).from(groups).where(inArray(groups.id, ids))).map((r) => r.id),
    'group'
  );

  return problems;
}

// Every row User Management reasons about, with its relations indexed. Loaded
// per request: the tables are small, and each decision needs current state.
async function loadGraph() {
  const [roleRows, userRows, assignRows, groupRows, ghRows, gmRows] = await Promise.all([
    db.select().from(roles),
    db.select().from(users),
    db.select().from(assignments),
    db.select().from(groups),
    db.select().from(groupHotels),
    db.select().from(groupMembers),
  ]);

  const push = <K, V>(map: Map<K, V[]>, key: K, value: V) => map.set(key, [...(map.get(key) ?? []), value]);
  const hotelsOfGroup = new Map<number, string[]>();
  ghRows.forEach((r) => push(hotelsOfGroup, r.groupId, r.hotelId));
  const membersOfGroup = new Map<number, number[]>();
  const groupsOfUser = new Map<number, number[]>();
  gmRows.forEach((r) => {
    push(membersOfGroup, r.groupId, r.userId);
    push(groupsOfUser, r.userId, r.groupId);
  });
  const assignsOfUser = new Map<number, { hotelId: string; roleId: string }[]>();
  assignRows.forEach((a) => push(assignsOfUser, a.userId, { hotelId: a.hotelId, roleId: a.roleId }));

  const rolesById = new Map(roleRows.map((r) => [r.id, { id: r.id, name: r.name, perms: normalizeRolePerms(r.perms) }]));
  const groupById = new Map(groupRows.map((g) => [g.id, g]));
  const hotelsOf = (groupId: number) => hotelsOfGroup.get(groupId) ?? [];
  const membersOf = (groupId: number) => membersOfGroup.get(groupId) ?? [];
  const groupsOf = (userId: number) => groupsOfUser.get(userId) ?? [];
  const assignmentsOf = (userId: number) => assignsOfUser.get(userId) ?? [];
  // The hotels a person is connected to: their direct assignments plus their groups' hotels.
  const connectedHotels = (userId: number) =>
    new Set([...assignmentsOf(userId).map((a) => a.hotelId), ...groupsOf(userId).flatMap(hotelsOf)]);

  return { roleRows, userRows, assignRows, groupRows, rolesById, groupById, hotelsOf, membersOf, groupsOf, assignmentsOf, connectedHotels };
}

const sameSet = <T,>(a: T[], b: T[]) => a.length === b.length && new Set([...a, ...b]).size === new Set(a).size;

const publicUser = (u: typeof users.$inferSelect) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  phone: u.phone,
  title: u.title,
  department: u.department,
  status: u.status,
  lastLogin: u.lastLogin,
  createdAt: u.createdAt,
});

// ── GET /api/access/scope — what the caller may see and change ───────────────
accessRoutes.get('/scope', authMiddleware, async (c) => {
  const scope = await loadManagementScope(Number(c.get('userId')));
  return c.json(
    scope.platform
      ? { platform: true, readHotelIds: [], crudHotelIds: [] }
      : { platform: false, readHotelIds: [...scope.read], crudHotelIds: [...scope.crud] }
  );
});

// ── GET /api/access/users ─────────────────────────────────────────────────────
accessRoutes.get('/users', authMiddleware, async (c) => {
  const scope = await loadManagementScope(Number(c.get('userId')));
  if (!canReadUserManagement(scope)) return c.json({ error: 'Forbidden' }, 403);
  const g = await loadGraph();

  const result = g.userRows
    .filter((u) => userVisible(scope, g.connectedHotels(u.id)))
    .map((u) => {
      const direct = g.assignmentsOf(u.id);
      const memberGroupIds = g.groupsOf(u.id);
      const groupGrants = memberGroupIds.flatMap((gid) => {
        const group = g.groupById.get(gid);
        if (!group) return [];
        const hotelIds = g.hotelsOf(gid);
        // A group outside the caller's view still grants access, so it still
        // counts — it is just not named.
        const groupName = groupVisible(scope, hotelIds) ? group.name : 'a group managed by a Platform Administrator';
        return hotelIds.map((hotelId) => ({ hotelId, roleId: group.roleId, groupName }));
      });
      const access = computeEffectiveAccess(g.rolesById, direct, groupGrants);
      const effective: Record<string, { roleId: string; roleName: string; sources: string[] }> = {};
      for (const [hotelId, entry] of Object.entries(access)) {
        if (!hotelInScope(scope, hotelId, 'read')) continue;
        effective[hotelId] = {
          roleId: entry.roleId,
          roleName: g.rolesById.get(entry.roleId)?.name ?? entry.roleId,
          sources: entry.sources,
        };
      }
      return {
        ...publicUser(u),
        assignments: direct.filter((a) => hotelInScope(scope, a.hotelId, 'read')),
        groupIds: memberGroupIds.filter((gid) => groupVisible(scope, g.hotelsOf(gid))),
        effective,
      };
    });

  return c.json(result);
});

// ── GET /api/access/roles ─────────────────────────────────────────────────────
// Roles are global definitions, readable by anyone in User Management. Usage is
// counted only within the caller's view.
accessRoutes.get('/roles', authMiddleware, async (c) => {
  const scope = await loadManagementScope(Number(c.get('userId')));
  if (!canReadUserManagement(scope)) return c.json({ error: 'Forbidden' }, 403);
  const g = await loadGraph();

  const result = g.roleRows.map((r) => {
    const perms = normalizeRolePerms(r.perms);
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      builtin: r.builtin,
      perms: withLegacyAccessKey(perms),
      // Whether this caller may give the role to someone.
      assignable: roleAssignable(scope, perms),
      usage: {
        direct: g.assignRows.filter((a) => a.roleId === r.id && hotelInScope(scope, a.hotelId, 'read')).length,
        groups: g.groupRows.filter((gr) => gr.roleId === r.id && groupVisible(scope, g.hotelsOf(gr.id))).length,
      },
    };
  });
  return c.json(result);
});

// ── GET /api/access/groups ────────────────────────────────────────────────────
accessRoutes.get('/groups', authMiddleware, async (c) => {
  const scope = await loadManagementScope(Number(c.get('userId')));
  if (!canReadUserManagement(scope)) return c.json({ error: 'Forbidden' }, 403);
  const g = await loadGraph();

  const result = g.groupRows
    .filter((gr) => groupVisible(scope, g.hotelsOf(gr.id)))
    .map((gr) => ({
      id: gr.id,
      name: gr.name,
      roleId: gr.roleId,
      roleName: g.rolesById.get(gr.roleId)?.name ?? gr.roleId,
      hotelIds: g.hotelsOf(gr.id),
      memberIds: g.membersOf(gr.id),
    }));
  return c.json(result);
});

// ── GET /api/access/hotels ────────────────────────────────────────────────────
accessRoutes.get('/hotels', authMiddleware, async (c) => {
  const scope = await loadManagementScope(Number(c.get('userId')));
  if (!canReadUserManagement(scope)) return c.json({ error: 'Forbidden' }, 403);
  const rows = await db.select().from(hotels).orderBy(hotels.sortOrder);
  return c.json(rows.filter((h) => hotelInScope(scope, h.id, 'read')));
});

// ── User mutations ────────────────────────────────────────────────────────────
// Accounts are prepared by an administrator and sign in with Google, so none is
// created with a password. Archiving replaces deletion: the account keeps its
// identity for audit history and its email stays reserved. Nobody can suspend
// or archive their own account here, and the last active Platform Administrator
// cannot be suspended or archived at all.

// Answer a refused lifecycle change with its status; anything else is a real error.
function refusal(c: Context, err: unknown) {
  if (err instanceof LifecycleRefusal) return c.json({ error: err.message }, err.status);
  throw err;
}

// POST /api/access/users — create an unassigned Google-only account (Platform Administrators).
accessRoutes.post('/users', authMiddleware, zValidator('json', createUserSchema), async (c) => {
  const scope = await loadManagementScope(Number(c.get('userId')));
  if (!scope.platform) return c.json({ error: PLATFORM_ONLY }, 403);
  const body = c.req.valid('json');

  const email = body.email.trim().toLowerCase();
  const [dupe] = await db.select({ status: users.status }).from(users).where(eq(users.email, email)).limit(1);
  if (dupe) {
    const error =
      dupe.status === 'archived'
        ? 'An archived account already uses that email. Restore it instead of creating a new one.'
        : 'Another user already has that email.';
    return c.json({ error }, 409);
  }

  const [created] = await db
    .insert(users)
    .values({
      email,
      passwordHash: null,
      name: body.name,
      phone: body.phone ?? null,
      title: body.title ?? null,
      department: body.department ?? null,
      status: 'active',
    })
    .returning();
  return c.json(publicUser(created), 201);
});

// POST /api/access/users/attach — give a person, found by exact email, a role at
// one hotel. When no account uses the email and a name is given, a Google-only
// account is created in the same step, so a Hotel Administrator never creates an
// account they cannot then see.
accessRoutes.post('/users/attach', authMiddleware, zValidator('json', attachUserSchema), async (c) => {
  const callerId = Number(c.get('userId'));
  const scope = await loadManagementScope(callerId);
  if (!canWriteUserManagement(scope)) return c.json({ error: 'Forbidden' }, 403);
  const body = c.req.valid('json');
  const email = body.email.trim().toLowerCase();

  if (!hotelInScope(scope, body.hotelId, 'crud')) return c.json({ error: OUTSIDE_SCOPE }, 403);
  const problems = await missingRefs({ hotelIds: [body.hotelId], roleIds: [body.roleId] });
  if (problems.length) return c.json({ error: problems.join(' ') }, 400);
  const [role] = await db.select({ perms: roles.perms }).from(roles).where(eq(roles.id, body.roleId)).limit(1);
  if (!roleAssignable(scope, normalizeRolePerms(role.perms))) return c.json({ error: NOT_ASSIGNABLE }, 403);

  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing?.id === callerId) {
    return c.json({ error: 'You cannot change your own access through User Management.' }, 400);
  }
  if (existing?.status === 'archived') {
    return c.json({ error: 'That account is archived. A Platform Administrator must restore it first.' }, 409);
  }
  if (!existing && !body.name) {
    return c.json({ error: 'No account uses that email. Enter their name to create one.' }, 404);
  }

  const account = await db.transaction(async (tx) => {
    const [row] = existing
      ? [existing]
      : await tx
          .insert(users)
          .values({
            email,
            passwordHash: null,
            name: body.name!,
            phone: body.phone ?? null,
            title: body.title ?? null,
            department: body.department ?? null,
            status: 'active',
          })
          .returning();
    await tx.delete(assignments).where(and(eq(assignments.userId, row.id), eq(assignments.hotelId, body.hotelId)));
    await tx.insert(assignments).values({ userId: row.id, hotelId: body.hotelId, roleId: body.roleId });
    return row;
  });

  return c.json(publicUser(account), existing ? 200 : 201);
});

accessRoutes.patch('/users/:id', authMiddleware, zValidator('json', updateUserSchema), async (c) => {
  const callerId = Number(c.get('userId'));
  const scope = await loadManagementScope(callerId);
  if (!scope.platform) return c.json({ error: PLATFORM_ONLY }, 403);
  const id = Number(c.req.param('id'));
  const patch = c.req.valid('json');
  if (patch.email) {
    const email = patch.email.trim().toLowerCase();
    const [dupe] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (dupe && dupe.id !== id) return c.json({ error: 'Another user already has that email.' }, 409);
    patch.email = email;
  }
  if (id === callerId && patch.status && patch.status !== 'active') {
    return c.json({ error: 'You cannot suspend your own account.' }, 400);
  }

  try {
    const updated = await db.transaction(async (tx) => {
      await lockAccountLifecycle(tx);
      const [current] = await tx.select({ status: users.status }).from(users).where(eq(users.id, id)).limit(1);
      if (!current) return null;
      if (current.status === 'archived') {
        throw new LifecycleRefusal('This account is archived. Restore it before editing it.', 409);
      }
      if (patch.status && patch.status !== 'active') await assertPlatformAdminRemains(tx, id);
      const [row] = await tx.update(users).set(patch).where(eq(users.id, id)).returning();
      // Suspension ends every session at once; reactivating later does not revive them.
      if (patch.status && patch.status !== 'active') await revokeUserSessions(id, 'account-status', tx);
      return row;
    });
    if (!updated) return c.json({ error: 'User not found' }, 404);
    return c.json(publicUser(updated));
  } catch (err) {
    return refusal(c, err);
  }
});

// DELETE /api/access/users/:id — archive the account; accounts are never hard-deleted.
accessRoutes.delete('/users/:id', authMiddleware, async (c) => {
  const callerId = Number(c.get('userId'));
  const scope = await loadManagementScope(callerId);
  if (!scope.platform) return c.json({ error: PLATFORM_ONLY }, 403);
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ error: 'Invalid id' }, 400);
  if (id === callerId) return c.json({ error: 'You cannot archive your own account.' }, 400);

  try {
    const found = await db.transaction(async (tx) => {
      await lockAccountLifecycle(tx);
      const [current] = await tx.select({ status: users.status }).from(users).where(eq(users.id, id)).limit(1);
      if (!current) return false;
      if (current.status === 'archived') return true;
      await assertPlatformAdminRemains(tx, id);
      await tx.update(users).set({ status: 'archived', archivedAt: new Date() }).where(eq(users.id, id));
      await revokeUserSessions(id, 'account-archived', tx);
      return true;
    });
    if (!found) return c.json({ error: 'User not found' }, 404);
    return c.json({ ok: true, archived: true });
  } catch (err) {
    return refusal(c, err);
  }
});

// POST /api/access/users/:id/restore — make an archived account Active again. Its
// old sessions stay revoked; the person signs in afresh.
accessRoutes.post('/users/:id/restore', authMiddleware, async (c) => {
  const scope = await loadManagementScope(Number(c.get('userId')));
  if (!scope.platform) return c.json({ error: PLATFORM_ONLY }, 403);
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ error: 'Invalid id' }, 400);

  const [restored] = await db
    .update(users)
    .set({ status: 'active', archivedAt: null })
    .where(and(eq(users.id, id), eq(users.status, 'archived')))
    .returning();
  if (restored) return c.json(publicUser(restored));

  const [exists] = await db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
  return exists
    ? c.json({ error: 'Only an archived account can be restored.' }, 409)
    : c.json({ error: 'User not found' }, 404);
});

accessRoutes.post('/users/:id/reset-password', authMiddleware, zValidator('json', resetPasswordSchema), async (c) => {
  const scope = await loadManagementScope(Number(c.get('userId')));
  if (!canWriteUserManagement(scope)) return c.json({ error: 'Forbidden' }, 403);
  // Retired: web administrators must not create replacement credentials or
  // turn a Google-only identity into a local-password account.
  return c.json({ error: 'Web password reset has been retired. Contact the server operator for account recovery.' }, 410);
});

// Replace a user's direct (non-group) property assignments. A Hotel Administrator
// replaces only the rows for hotels they administer; the rest stay as they were.
accessRoutes.put('/users/:id/assignments', authMiddleware, zValidator('json', assignmentsSchema), async (c) => {
  const callerId = Number(c.get('userId'));
  const scope = await loadManagementScope(callerId);
  if (!canWriteUserManagement(scope)) return c.json({ error: 'Forbidden' }, 403);
  const id = Number(c.req.param('id'));
  if (id === callerId) return c.json({ error: 'You cannot change your own access through User Management.' }, 400);
  const [target] = await db.select({ status: users.status }).from(users).where(eq(users.id, id)).limit(1);
  if (!target) return c.json({ error: 'User not found' }, 404);
  const { assignments: rows } = c.req.valid('json');

  const g = await loadGraph();
  if (!userVisible(scope, g.connectedHotels(id))) return c.json({ error: 'User not found' }, 404);
  if (target.status === 'archived') {
    return c.json({ error: 'This account is archived. Restore it before changing its access.' }, 409);
  }

  const problems = await missingRefs({
    hotelIds: rows.map((a) => a.hotelId),
    roleIds: rows.map((a) => a.roleId),
  });
  if (problems.length) return c.json({ error: problems.join(' ') }, 400);

  if (!scope.platform) {
    const current = new Set(g.assignmentsOf(id).map((a) => `${a.hotelId} ${a.roleId}`));
    for (const row of rows) {
      if (current.has(`${row.hotelId} ${row.roleId}`)) continue; // unchanged rows are always fine
      if (!hotelInScope(scope, row.hotelId, 'crud')) return c.json({ error: OUTSIDE_SCOPE }, 403);
      const role = g.rolesById.get(row.roleId);
      if (!role || !roleAssignable(scope, role.perms)) return c.json({ error: NOT_ASSIGNABLE }, 403);
    }
  }

  // One transaction. This replaces grants by clearing them first, so a failure
  // half-way would otherwise strip every property the user had.
  await db.transaction(async (tx) => {
    if (scope.platform) {
      await tx.delete(assignments).where(eq(assignments.userId, id));
      if (rows.length) {
        await tx.insert(assignments).values(rows.map((a) => ({ userId: id, hotelId: a.hotelId, roleId: a.roleId })));
      }
      return;
    }
    const managed = [...scope.crud];
    await tx.delete(assignments).where(and(eq(assignments.userId, id), inArray(assignments.hotelId, managed)));
    const kept = rows.filter((a) => scope.crud.has(a.hotelId));
    if (kept.length) {
      await tx.insert(assignments).values(kept.map((a) => ({ userId: id, hotelId: a.hotelId, roleId: a.roleId })));
    }
  });

  return c.json({ ok: true });
});

// Replace a user's group memberships. A Hotel Administrator changes only
// memberships of groups they can manage; the rest stay as they were.
accessRoutes.put('/users/:id/groups', authMiddleware, zValidator('json', membershipSchema), async (c) => {
  const callerId = Number(c.get('userId'));
  const scope = await loadManagementScope(callerId);
  if (!canWriteUserManagement(scope)) return c.json({ error: 'Forbidden' }, 403);
  const id = Number(c.req.param('id'));
  if (id === callerId) return c.json({ error: 'You cannot change your own access through User Management.' }, 400);
  const [target] = await db.select({ status: users.status }).from(users).where(eq(users.id, id)).limit(1);
  if (!target) return c.json({ error: 'User not found' }, 404);
  const { groupIds } = c.req.valid('json');

  const g = await loadGraph();
  if (!userVisible(scope, g.connectedHotels(id))) return c.json({ error: 'User not found' }, 404);
  if (target.status === 'archived') {
    return c.json({ error: 'This account is archived. Restore it before changing its access.' }, 409);
  }

  const problems = await missingRefs({ groupIds });
  if (problems.length) return c.json({ error: problems.join(' ') }, 400);

  const manageable = new Set(g.groupRows.filter((gr) => groupManageable(scope, g.hotelsOf(gr.id))).map((gr) => gr.id));
  if (!scope.platform) {
    const current = new Set(g.groupsOf(id));
    for (const gid of groupIds) {
      if (current.has(gid)) continue;
      if (!manageable.has(gid)) return c.json({ error: OUTSIDE_SCOPE }, 403);
      const role = g.rolesById.get(g.groupById.get(gid)!.roleId);
      if (!role || !roleAssignable(scope, role.perms)) return c.json({ error: NOT_ASSIGNABLE }, 403);
    }
  }

  // Same replace-by-clearing shape as assignments, so same atomic boundary.
  await db.transaction(async (tx) => {
    if (scope.platform) {
      await tx.delete(groupMembers).where(eq(groupMembers.userId, id));
      if (groupIds.length) {
        await tx.insert(groupMembers).values(groupIds.map((gid) => ({ userId: id, groupId: gid })));
      }
      return;
    }
    if (manageable.size) {
      await tx
        .delete(groupMembers)
        .where(and(eq(groupMembers.userId, id), inArray(groupMembers.groupId, [...manageable])));
    }
    const kept = groupIds.filter((gid) => manageable.has(gid));
    if (kept.length) {
      await tx.insert(groupMembers).values(kept.map((gid) => ({ userId: id, groupId: gid })));
    }
  });

  return c.json({ ok: true });
});

// ── Role mutations (Platform Administrators) ─────────────────────────────────
accessRoutes.post('/roles', authMiddleware, zValidator('json', createRoleSchema), async (c) => {
  const scope = await loadManagementScope(Number(c.get('userId')));
  if (!scope.platform) return c.json({ error: PLATFORM_ONLY }, 403);
  const body = c.req.valid('json');
  const id = 'r-' + Date.now().toString(36);
  const [created] = await db
    .insert(roles)
    .values({
      id,
      name: body.name,
      description: body.description,
      builtin: false,
      perms: withLegacyAccessKey(normalizeRolePerms(body.perms)),
    })
    .returning();
  return c.json(created, 201);
});

accessRoutes.patch('/roles/:id', authMiddleware, zValidator('json', updateRoleSchema), async (c) => {
  const scope = await loadManagementScope(Number(c.get('userId')));
  if (!scope.platform) return c.json({ error: PLATFORM_ONLY }, 403);
  const id = c.req.param('id');
  const [role] = await db.select().from(roles).where(eq(roles.id, id)).limit(1);
  if (!role) return c.json({ error: 'Role not found' }, 404);
  if (role.builtin) return c.json({ error: 'Built-in roles cannot be edited.' }, 400);
  const patch = c.req.valid('json');
  const [updated] = await db
    .update(roles)
    .set({ ...patch, perms: patch.perms ? withLegacyAccessKey(normalizeRolePerms(patch.perms)) : undefined })
    .where(eq(roles.id, id))
    .returning();
  return c.json(updated);
});

accessRoutes.delete('/roles/:id', authMiddleware, async (c) => {
  const scope = await loadManagementScope(Number(c.get('userId')));
  if (!scope.platform) return c.json({ error: PLATFORM_ONLY }, 403);
  const id = c.req.param('id');
  const [role] = await db.select().from(roles).where(eq(roles.id, id)).limit(1);
  if (!role) return c.json({ error: 'Role not found' }, 404);
  if (role.builtin) return c.json({ error: 'Built-in roles cannot be deleted.' }, 400);
  const inUse =
    (await db.select({ id: assignments.id }).from(assignments).where(eq(assignments.roleId, id)).limit(1)).length > 0 ||
    (await db.select({ id: groups.id }).from(groups).where(eq(groups.roleId, id)).limit(1)).length > 0;
  if (inUse) return c.json({ error: 'Role is still assigned — remove assignments first.' }, 400);
  await db.delete(roles).where(eq(roles.id, id));
  return c.json({ ok: true });
});

// ── Group mutations ───────────────────────────────────────────────────────────
// A Hotel Administrator manages groups whose hotels all lie among the hotels they
// administer, with roles they may assign and members already connected to their
// hotels. Nobody changes the grant of a group they belong to — its role, its
// hotels or their own membership — or deletes it: that would change their own
// authority.

// `tx` is the transaction handle, so the caller decides the atomic boundary.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function setGroupRelations(tx: Tx, groupId: number, hotelIds: string[], memberIds: number[]) {
  await tx.delete(groupHotels).where(eq(groupHotels.groupId, groupId));
  if (hotelIds.length) {
    await tx.insert(groupHotels).values(hotelIds.map((hotelId) => ({ groupId, hotelId })));
  }
  await tx.delete(groupMembers).where(eq(groupMembers.groupId, groupId));
  if (memberIds.length) {
    await tx.insert(groupMembers).values(memberIds.map((userId) => ({ groupId, userId })));
  }
}

accessRoutes.post('/groups', authMiddleware, zValidator('json', createGroupSchema), async (c) => {
  const scope = await loadManagementScope(Number(c.get('userId')));
  if (!canWriteUserManagement(scope)) return c.json({ error: 'Forbidden' }, 403);
  const body = c.req.valid('json');

  const problems = await missingRefs({
    hotelIds: body.hotelIds,
    roleIds: [body.roleId],
    userIds: body.memberIds,
  });
  if (problems.length) return c.json({ error: problems.join(' ') }, 400);

  if (!scope.platform) {
    if (!hotelsWithin(scope, body.hotelIds, 'crud')) return c.json({ error: OUTSIDE_SCOPE }, 403);
    const g = await loadGraph();
    const role = g.rolesById.get(body.roleId);
    if (!role || !roleAssignable(scope, role.perms)) return c.json({ error: NOT_ASSIGNABLE }, 403);
    if (!body.memberIds.every((uid) => userVisible(scope, g.connectedHotels(uid)))) {
      return c.json({ error: ATTACH_FIRST }, 403);
    }
  }

  // One transaction: a group row must never survive a failure to attach its
  // properties or members, or the list fills with empty unusable groups.
  const created = await db.transaction(async (tx) => {
    const [row] = await tx.insert(groups).values({ name: body.name, roleId: body.roleId }).returning();
    await setGroupRelations(tx, row.id, body.hotelIds, body.memberIds);
    return row;
  });

  return c.json(created, 201);
});

accessRoutes.patch('/groups/:id', authMiddleware, zValidator('json', updateGroupSchema), async (c) => {
  const callerId = Number(c.get('userId'));
  const scope = await loadManagementScope(callerId);
  if (!canWriteUserManagement(scope)) return c.json({ error: 'Forbidden' }, 403);
  const id = Number(c.req.param('id'));
  const body = c.req.valid('json');

  const g = await loadGraph();
  const existing = g.groupById.get(id);
  const currentHotels = existing ? g.hotelsOf(id) : [];
  if (!existing || !groupVisible(scope, currentHotels)) return c.json({ error: 'Group not found' }, 404);
  if (!groupManageable(scope, currentHotels)) return c.json({ error: OUTSIDE_SCOPE }, 403);

  const problems = await missingRefs({
    hotelIds: body.hotelIds,
    roleIds: body.roleId !== undefined ? [body.roleId] : undefined,
    userIds: body.memberIds,
  });
  if (problems.length) return c.json({ error: problems.join(' ') }, 400);

  const currentMembers = g.membersOf(id);
  const roleChanges = body.roleId !== undefined && body.roleId !== existing.roleId;
  const hotelsChange = body.hotelIds !== undefined && !sameSet(body.hotelIds, currentHotels);
  if (currentMembers.includes(callerId) && (roleChanges || hotelsChange || (body.memberIds !== undefined && !body.memberIds.includes(callerId)))) {
    return c.json({ error: 'You cannot change the role, properties or your own membership of a group you belong to.' }, 400);
  }

  if (!scope.platform) {
    if (body.hotelIds && !hotelsWithin(scope, body.hotelIds, 'crud')) return c.json({ error: OUTSIDE_SCOPE }, 403);
    if (roleChanges) {
      const role = g.rolesById.get(body.roleId!);
      if (!role || !roleAssignable(scope, role.perms)) return c.json({ error: NOT_ASSIGNABLE }, 403);
    }
    if (body.memberIds) {
      const members = new Set(currentMembers);
      if (!body.memberIds.every((uid) => members.has(uid) || userVisible(scope, g.connectedHotels(uid)))) {
        return c.json({ error: ATTACH_FIRST }, 403);
      }
    }
  }

  // One transaction: the old properties and members are cleared as part of the
  // same unit that writes the new ones, so a failure can't leave the group with
  // nothing attached.
  await db.transaction(async (tx) => {
    const fields: Record<string, unknown> = {};
    if (body.name !== undefined) fields.name = body.name;
    if (body.roleId !== undefined) fields.roleId = body.roleId;
    if (Object.keys(fields).length) {
      await tx.update(groups).set(fields).where(eq(groups.id, id));
    }
    if (body.hotelIds !== undefined) {
      await tx.delete(groupHotels).where(eq(groupHotels.groupId, id));
      if (body.hotelIds.length) {
        await tx.insert(groupHotels).values(body.hotelIds.map((hotelId) => ({ groupId: id, hotelId })));
      }
    }
    if (body.memberIds !== undefined) {
      await tx.delete(groupMembers).where(eq(groupMembers.groupId, id));
      if (body.memberIds.length) {
        await tx.insert(groupMembers).values(body.memberIds.map((userId) => ({ groupId: id, userId })));
      }
    }
  });

  return c.json({ ok: true });
});

accessRoutes.delete('/groups/:id', authMiddleware, async (c) => {
  const callerId = Number(c.get('userId'));
  const scope = await loadManagementScope(callerId);
  if (!canWriteUserManagement(scope)) return c.json({ error: 'Forbidden' }, 403);
  const id = Number(c.req.param('id'));

  const g = await loadGraph();
  const existing = g.groupById.get(id);
  const currentHotels = existing ? g.hotelsOf(id) : [];
  if (!existing || !groupVisible(scope, currentHotels)) return c.json({ error: 'Group not found' }, 404);
  if (!groupManageable(scope, currentHotels)) return c.json({ error: OUTSIDE_SCOPE }, 403);
  if (g.membersOf(id).includes(callerId)) {
    return c.json({ error: 'You cannot delete a group you belong to.' }, 400);
  }

  await db.delete(groups).where(eq(groups.id, id)); // cascades to group_hotels / group_members
  return c.json({ ok: true });
});
