// Who can see and change what in User Management
// (docs/specs/security-hardening-and-user-management.md, "User Management
// rename and authorization").
//
// A Platform Administrator (users.platform_admin) is unscoped. Anyone else is
// scoped to the hotels where they hold the User Management permission: READ to
// see, CRUD to change. The rules are pure so the routes and their tests share
// one definition; only loadManagementScope touches the database.
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { users, type PermLevel, type RolePerms } from '../db/schema';
import { buildUserContext } from './session';

export type ManagementScope =
  | { platform: true }
  | { platform: false; read: ReadonlySet<string>; crud: ReadonlySet<string> };

export function scopeFromHotelGrants(grants: { hotelId: string; level: PermLevel }[]): ManagementScope {
  const read = new Set<string>();
  const crud = new Set<string>();
  for (const { hotelId, level } of grants) {
    if (level !== 'none') read.add(hotelId);
    if (level === 'crud') crud.add(hotelId);
  }
  return { platform: false, read, crud };
}

export const canReadUserManagement = (scope: ManagementScope) => scope.platform || scope.read.size > 0;
export const canWriteUserManagement = (scope: ManagementScope) => scope.platform || scope.crud.size > 0;

export function hotelInScope(scope: ManagementScope, hotelId: string, level: 'read' | 'crud'): boolean {
  return scope.platform || (level === 'read' ? scope.read : scope.crud).has(hotelId);
}

export function hotelsWithin(scope: ManagementScope, hotelIds: string[], level: 'read' | 'crud'): boolean {
  return hotelIds.every((hotelId) => hotelInScope(scope, hotelId, level));
}

/** Only a Platform Administrator may hand out User Management CRUD, so authority cannot spread on its own. */
export function roleAssignable(scope: ManagementScope, perms: Pick<RolePerms, 'userManagement'>): boolean {
  return scope.platform || perms.userManagement !== 'crud';
}

/** A person is visible when they are connected (directly or through a group) to a hotel in view. */
export function userVisible(scope: ManagementScope, connectedHotelIds: Iterable<string>): boolean {
  if (scope.platform) return true;
  for (const hotelId of connectedHotelIds) if (scope.read.has(hotelId)) return true;
  return false;
}

/** A group is visible only when every hotel it grants lies in view; one reaching further belongs to the platform. */
export function groupVisible(scope: ManagementScope, groupHotelIds: string[]): boolean {
  return scope.platform || (groupHotelIds.length > 0 && hotelsWithin(scope, groupHotelIds, 'read'));
}

export function groupManageable(scope: ManagementScope, groupHotelIds: string[]): boolean {
  return scope.platform || (groupHotelIds.length > 0 && hotelsWithin(scope, groupHotelIds, 'crud'));
}

export async function loadManagementScope(userId: number): Promise<ManagementScope> {
  const [row] = await db.select({ platformAdmin: users.platformAdmin }).from(users).where(eq(users.id, userId)).limit(1);
  if (row?.platformAdmin) return { platform: true };
  const ctx = await buildUserContext(userId);
  return scopeFromHotelGrants(ctx.hotels.map((h) => ({ hotelId: h.id, level: h.perms.userManagement })));
}
