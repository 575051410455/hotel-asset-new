// ─────────────────────────────────────────────────────────────────────────────
// Role-based access control — server port of the prototype's auth-config logic.
//
// Access is granted PER PROPERTY (hotel), either directly on the user or via a
// group (role + set of properties + members). When several sources grant access
// to the same property, the STRONGEST role wins (highest summed perm score).
// ─────────────────────────────────────────────────────────────────────────────
import { eq } from 'drizzle-orm';
import { db } from '../db';
import {
  roles as rolesTable,
  assignments as assignmentsTable,
  groups as groupsTable,
  groupHotels as groupHotelsTable,
  groupMembers as groupMembersTable,
  type RolePerms,
  type PermLevel,
} from '../db/schema';
import { PERM_RESOURCES, normalizeRolePerms, type Resource } from './permissions';

export { PERM_RESOURCES, type Resource };

const SCORE: Record<PermLevel, number> = { none: 0, read: 1, crud: 2 };
export function permScore(p: PermLevel | undefined): number {
  return p ? SCORE[p] : 0;
}

// Rank a role by the sum of its permission scores (matches prototype roleRank).
export function roleRank(perms: RolePerms): number {
  return PERM_RESOURCES.reduce((s, r) => s + permScore(perms[r]), 0);
}

export type AccessEntry = { roleId: string; sources: string[] };
// { [hotelId]: { roleId, sources } }
export type EffectiveAccess = Record<string, AccessEntry>;

type RoleLite = { id: string; perms: RolePerms };

// Merge direct assignments + group grants into per-hotel effective access.
export function computeEffectiveAccess(
  rolesById: Map<string, RoleLite>,
  direct: Array<{ hotelId: string; roleId: string }>,
  groupGrants: Array<{ hotelId: string; roleId: string; groupName: string }>
): EffectiveAccess {
  const acc: EffectiveAccess = {};
  const apply = (hotelId: string, roleId: string, source: string) => {
    const cur = acc[hotelId];
    if (!cur) {
      acc[hotelId] = { roleId, sources: [source] };
      return;
    }
    cur.sources.push(source);
    const incoming = rolesById.get(roleId);
    const existing = rolesById.get(cur.roleId);
    if (incoming && existing && roleRank(incoming.perms) > roleRank(existing.perms)) {
      cur.roleId = roleId;
    }
  };
  direct.forEach((a) => apply(a.hotelId, a.roleId, 'direct'));
  groupGrants.forEach((g) => apply(g.hotelId, g.roleId, 'group:' + g.groupName));
  return acc;
}

// Highest permission level the user holds for a resource — over one hotel or all.
export function bestPermFor(
  access: EffectiveAccess,
  rolesById: Map<string, RoleLite>,
  resource: Resource,
  hotelId?: string
): PermLevel {
  const hotelIds = hotelId ? [hotelId] : Object.keys(access);
  let best: PermLevel = 'none';
  for (const h of hotelIds) {
    const entry = access[h];
    if (!entry) continue;
    const role = rolesById.get(entry.roleId);
    if (!role) continue;
    const p = role.perms[resource] ?? 'none';
    if (permScore(p) > permScore(best)) best = p;
  }
  return best;
}

// ── DB-backed loaders ────────────────────────────────────────────────────────

export async function loadRolesById(): Promise<Map<string, RoleLite>> {
  const rows = await db.select().from(rolesTable);
  return new Map(rows.map((r) => [r.id, { id: r.id, perms: normalizeRolePerms(r.perms) }]));
}

// Compute a user's effective access straight from the database.
export async function getUserAccess(userId: number): Promise<{
  access: EffectiveAccess;
  rolesById: Map<string, RoleLite>;
}> {
  const rolesById = await loadRolesById();

  const direct = await db
    .select({
      hotelId: assignmentsTable.hotelId,
      roleId: assignmentsTable.roleId,
    })
    .from(assignmentsTable)
    .where(eq(assignmentsTable.userId, userId));

  // Groups the user belongs to → their role + granted hotels.
  const memberGroups = await db
    .select({
      groupId: groupsTable.id,
      groupName: groupsTable.name,
      roleId: groupsTable.roleId,
    })
    .from(groupMembersTable)
    .innerJoin(groupsTable, eq(groupMembersTable.groupId, groupsTable.id))
    .where(eq(groupMembersTable.userId, userId));

  const groupGrants: Array<{ hotelId: string; roleId: string; groupName: string }> = [];
  for (const g of memberGroups) {
    const hotels = await db
      .select({ hotelId: groupHotelsTable.hotelId })
      .from(groupHotelsTable)
      .where(eq(groupHotelsTable.groupId, g.groupId));
    hotels.forEach((h) =>
      groupGrants.push({ hotelId: h.hotelId, roleId: g.roleId, groupName: g.groupName })
    );
  }

  const access = computeEffectiveAccess(rolesById, direct, groupGrants);
  return { access, rolesById };
}

// Hotel ids the user can at least read devices for (used to scope the dashboard).
export function accessibleHotelIds(access: EffectiveAccess): string[] {
  return Object.keys(access);
}
