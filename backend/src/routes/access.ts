import { Hono } from 'hono';
import { eq, inArray } from 'drizzle-orm';
import { zValidator } from '@hono/zod-validator';
import bcrypt from 'bcryptjs';
import { db } from '../db';
import {
  users,
  roles,
  groups,
  groupHotels,
  groupMembers,
  assignments,
  hotels,
  type RolePerms,
} from '../db/schema';
import {
  createUserSchema,
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
import { buildUserContext, maxPerm } from '../lib/session';
import { computeEffectiveAccess } from '../lib/rbac';

export const accessRoutes = new Hono<{ Variables: AuthVariables }>();

const ROLE_NAMES: Record<string, string> = {
  admin: 'Administrator',
  manager: 'IT Manager',
  viewer: 'Viewer',
};

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

// Gate every request on the caller's global `access` permission.
async function gate(userId: number, level: 'read' | 'crud') {
  const ctx = await buildUserContext(userId);
  const have = maxPerm(ctx, 'access');
  const ok = level === 'read' ? have === 'read' || have === 'crud' : have === 'crud';
  return { ok, have };
}

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

// ── GET /api/access/users ─────────────────────────────────────────────────────
accessRoutes.get('/users', authMiddleware, async (c) => {
  const { ok } = await gate(Number(c.get('userId')), 'read');
  if (!ok) return c.json({ error: 'Forbidden' }, 403);

  const [roleRows, userRows, assignRows, groupRows, ghRows, gmRows] = await Promise.all([
    db.select().from(roles),
    db.select().from(users),
    db.select().from(assignments),
    db.select().from(groups),
    db.select().from(groupHotels),
    db.select().from(groupMembers),
  ]);

  const rolesById = new Map(roleRows.map((r) => [r.id, { id: r.id, perms: r.perms as RolePerms }]));
  const roleNameById = new Map(roleRows.map((r) => [r.id, r.name]));
  const hotelsOfGroup = new Map<number, string[]>();
  ghRows.forEach((g) => hotelsOfGroup.set(g.groupId, [...(hotelsOfGroup.get(g.groupId) ?? []), g.hotelId]));
  const groupById = new Map(groupRows.map((g) => [g.id, g]));
  const groupsOfUser = new Map<number, number[]>();
  gmRows.forEach((m) => groupsOfUser.set(m.userId, [...(groupsOfUser.get(m.userId) ?? []), m.groupId]));
  const assignsOfUser = new Map<number, { hotelId: string; roleId: string }[]>();
  assignRows.forEach((a) =>
    assignsOfUser.set(a.userId, [...(assignsOfUser.get(a.userId) ?? []), { hotelId: a.hotelId, roleId: a.roleId }])
  );

  const result = userRows.map((u) => {
    const direct = assignsOfUser.get(u.id) ?? [];
    const memberGroupIds = groupsOfUser.get(u.id) ?? [];
    const groupGrants = memberGroupIds.flatMap((gid) => {
      const g = groupById.get(gid);
      if (!g) return [];
      return (hotelsOfGroup.get(gid) ?? []).map((hotelId) => ({
        hotelId,
        roleId: g.roleId,
        groupName: g.name,
      }));
    });
    const access = computeEffectiveAccess(rolesById, direct, groupGrants);
    const effective: Record<string, { roleId: string; roleName: string; sources: string[] }> = {};
    for (const [hid, entry] of Object.entries(access)) {
      effective[hid] = {
        roleId: entry.roleId,
        roleName: roleNameById.get(entry.roleId) ?? entry.roleId,
        sources: entry.sources,
      };
    }
    return { ...publicUser(u), assignments: direct, groupIds: memberGroupIds, effective };
  });

  return c.json(result);
});

// ── GET /api/access/roles ─────────────────────────────────────────────────────
accessRoutes.get('/roles', authMiddleware, async (c) => {
  const { ok } = await gate(Number(c.get('userId')), 'read');
  if (!ok) return c.json({ error: 'Forbidden' }, 403);

  const [roleRows, assignRows, groupRows] = await Promise.all([
    db.select().from(roles),
    db.select().from(assignments),
    db.select().from(groups),
  ]);
  const result = roleRows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    builtin: r.builtin,
    perms: r.perms,
    usage: {
      direct: assignRows.filter((a) => a.roleId === r.id).length,
      groups: groupRows.filter((g) => g.roleId === r.id).length,
    },
  }));
  return c.json(result);
});

// ── GET /api/access/groups ────────────────────────────────────────────────────
accessRoutes.get('/groups', authMiddleware, async (c) => {
  const { ok } = await gate(Number(c.get('userId')), 'read');
  if (!ok) return c.json({ error: 'Forbidden' }, 403);

  const [groupRows, ghRows, gmRows] = await Promise.all([
    db.select().from(groups),
    db.select().from(groupHotels),
    db.select().from(groupMembers),
  ]);
  const result = groupRows.map((g) => ({
    id: g.id,
    name: g.name,
    roleId: g.roleId,
    roleName: ROLE_NAMES[g.roleId] ?? g.roleId,
    hotelIds: ghRows.filter((x) => x.groupId === g.id).map((x) => x.hotelId),
    memberIds: gmRows.filter((x) => x.groupId === g.id).map((x) => x.userId),
  }));
  return c.json(result);
});

// ── GET /api/access/hotels (all properties) ──────────────────────────────────
accessRoutes.get('/hotels', authMiddleware, async (c) => {
  const { ok } = await gate(Number(c.get('userId')), 'read');
  if (!ok) return c.json({ error: 'Forbidden' }, 403);
  const rows = await db.select().from(hotels).orderBy(hotels.sortOrder);
  return c.json(rows);
});

// ── User mutations ────────────────────────────────────────────────────────────
accessRoutes.post('/users', authMiddleware, zValidator('json', createUserSchema), async (c) => {
  const { ok } = await gate(Number(c.get('userId')), 'crud');
  if (!ok) return c.json({ error: 'Forbidden' }, 403);
  const body = c.req.valid('json');

  const email = body.email.toLowerCase();
  const [dupe] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (dupe) return c.json({ error: 'Another user already has that email.' }, 409);

  const passwordHash = await bcrypt.hash(body.password, 10);
  const [created] = await db
    .insert(users)
    .values({
      email,
      passwordHash,
      name: body.name,
      phone: body.phone ?? null,
      title: body.title ?? null,
      department: body.department ?? null,
      status: 'active',
    })
    .returning();
  return c.json(publicUser(created), 201);
});

accessRoutes.patch('/users/:id', authMiddleware, zValidator('json', updateUserSchema), async (c) => {
  const { ok } = await gate(Number(c.get('userId')), 'crud');
  if (!ok) return c.json({ error: 'Forbidden' }, 403);
  const id = Number(c.req.param('id'));
  const patch = c.req.valid('json');
  if (patch.email) {
    const email = patch.email.toLowerCase();
    const [dupe] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (dupe && dupe.id !== id) return c.json({ error: 'Another user already has that email.' }, 409);
    patch.email = email;
  }
  const [updated] = await db.update(users).set(patch).where(eq(users.id, id)).returning();
  if (!updated) return c.json({ error: 'User not found' }, 404);
  return c.json(publicUser(updated));
});

accessRoutes.delete('/users/:id', authMiddleware, async (c) => {
  const callerId = Number(c.get('userId'));
  const { ok } = await gate(callerId, 'crud');
  if (!ok) return c.json({ error: 'Forbidden' }, 403);
  const id = Number(c.req.param('id'));
  if (id === callerId) return c.json({ error: 'You cannot delete your own account.' }, 400);
  await db.delete(users).where(eq(users.id, id));
  return c.json({ ok: true });
});

accessRoutes.post('/users/:id/reset-password', authMiddleware, zValidator('json', resetPasswordSchema), async (c) => {
  const { ok } = await gate(Number(c.get('userId')), 'crud');
  if (!ok) return c.json({ error: 'Forbidden' }, 403);
  // Retired: web administrators must not create replacement credentials or
  // turn a Google-only identity into a local-password account.
  return c.json({ error: 'Web password reset has been retired. Contact the server operator for account recovery.' }, 410);
});

// Replace a user's direct (non-group) property assignments.
accessRoutes.put('/users/:id/assignments', authMiddleware, zValidator('json', assignmentsSchema), async (c) => {
  const { ok } = await gate(Number(c.get('userId')), 'crud');
  if (!ok) return c.json({ error: 'Forbidden' }, 403);
  const id = Number(c.req.param('id'));
  const [target] = await db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
  if (!target) return c.json({ error: 'User not found' }, 404);
  const { assignments: rows } = c.req.valid('json');

  const problems = await missingRefs({
    hotelIds: rows.map((a) => a.hotelId),
    roleIds: rows.map((a) => a.roleId),
  });
  if (problems.length) return c.json({ error: problems.join(' ') }, 400);

  // One transaction. This replaces the user's grants by clearing them first, so
  // a failure half-way would otherwise strip every property they had.
  await db.transaction(async (tx) => {
    await tx.delete(assignments).where(eq(assignments.userId, id));
    if (rows.length) {
      await tx.insert(assignments).values(rows.map((a) => ({ userId: id, hotelId: a.hotelId, roleId: a.roleId })));
    }
  });

  return c.json({ ok: true });
});

// Replace a user's group memberships.
accessRoutes.put('/users/:id/groups', authMiddleware, zValidator('json', membershipSchema), async (c) => {
  const { ok } = await gate(Number(c.get('userId')), 'crud');
  if (!ok) return c.json({ error: 'Forbidden' }, 403);
  const id = Number(c.req.param('id'));
  const [target] = await db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
  if (!target) return c.json({ error: 'User not found' }, 404);
  const { groupIds } = c.req.valid('json');

  const problems = await missingRefs({ groupIds });
  if (problems.length) return c.json({ error: problems.join(' ') }, 400);

  // Same replace-by-clearing shape as assignments, so same atomic boundary.
  await db.transaction(async (tx) => {
    await tx.delete(groupMembers).where(eq(groupMembers.userId, id));
    if (groupIds.length) {
      await tx.insert(groupMembers).values(groupIds.map((gid) => ({ userId: id, groupId: gid })));
    }
  });

  return c.json({ ok: true });
});

// ── Role mutations ────────────────────────────────────────────────────────────
accessRoutes.post('/roles', authMiddleware, zValidator('json', createRoleSchema), async (c) => {
  const { ok } = await gate(Number(c.get('userId')), 'crud');
  if (!ok) return c.json({ error: 'Forbidden' }, 403);
  const body = c.req.valid('json');
  const id = 'r-' + Date.now().toString(36);
  const [created] = await db
    .insert(roles)
    .values({ id, name: body.name, description: body.description, builtin: false, perms: body.perms })
    .returning();
  return c.json(created, 201);
});

accessRoutes.patch('/roles/:id', authMiddleware, zValidator('json', updateRoleSchema), async (c) => {
  const { ok } = await gate(Number(c.get('userId')), 'crud');
  if (!ok) return c.json({ error: 'Forbidden' }, 403);
  const id = c.req.param('id');
  const [role] = await db.select().from(roles).where(eq(roles.id, id)).limit(1);
  if (!role) return c.json({ error: 'Role not found' }, 404);
  if (role.builtin) return c.json({ error: 'Built-in roles cannot be edited.' }, 400);
  const [updated] = await db.update(roles).set(c.req.valid('json')).where(eq(roles.id, id)).returning();
  return c.json(updated);
});

accessRoutes.delete('/roles/:id', authMiddleware, async (c) => {
  const { ok } = await gate(Number(c.get('userId')), 'crud');
  if (!ok) return c.json({ error: 'Forbidden' }, 403);
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
  const { ok } = await gate(Number(c.get('userId')), 'crud');
  if (!ok) return c.json({ error: 'Forbidden' }, 403);
  const body = c.req.valid('json');

  const problems = await missingRefs({
    hotelIds: body.hotelIds,
    roleIds: [body.roleId],
    userIds: body.memberIds,
  });
  if (problems.length) return c.json({ error: problems.join(' ') }, 400);

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
  const { ok } = await gate(Number(c.get('userId')), 'crud');
  if (!ok) return c.json({ error: 'Forbidden' }, 403);
  const id = Number(c.req.param('id'));
  const body = c.req.valid('json');

  const [existing] = await db.select({ id: groups.id }).from(groups).where(eq(groups.id, id)).limit(1);
  if (!existing) return c.json({ error: 'Group not found' }, 404);

  const problems = await missingRefs({
    hotelIds: body.hotelIds,
    roleIds: body.roleId !== undefined ? [body.roleId] : undefined,
    userIds: body.memberIds,
  });
  if (problems.length) return c.json({ error: problems.join(' ') }, 400);

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
  const { ok } = await gate(Number(c.get('userId')), 'crud');
  if (!ok) return c.json({ error: 'Forbidden' }, 403);
  const id = Number(c.req.param('id'));
  await db.delete(groups).where(eq(groups.id, id)); // cascades to group_hotels / group_members
  return c.json({ ok: true });
});
