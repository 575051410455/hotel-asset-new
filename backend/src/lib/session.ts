// Builds the per-user context the frontend needs: profile + the list of hotels
// the user can access, each annotated with the user's effective role and perms.
import { inArray } from 'drizzle-orm';
import { db } from '../db';
import { hotels as hotelsTable, type RolePerms } from '../db/schema';
import { getUserAccess, accessibleHotelIds, type EffectiveAccess } from './rbac';

export type HotelAccess = {
  id: string;
  code: string;
  name: string;
  city: string;
  sortOrder: number;
  roleId: string;
  roleName: string;
  perms: RolePerms;
  sources: string[];
};

export type UserContext = {
  access: EffectiveAccess;
  hotels: HotelAccess[];
};

const ROLE_NAMES: Record<string, string> = {
  admin: 'Administrator',
  manager: 'IT Manager',
  viewer: 'Viewer',
};

export async function buildUserContext(userId: number): Promise<UserContext> {
  const { access, rolesById } = await getUserAccess(userId);
  const ids = accessibleHotelIds(access);
  if (ids.length === 0) return { access, hotels: [] };

  const rows = await db
    .select()
    .from(hotelsTable)
    .where(inArray(hotelsTable.id, ids));

  const hotels: HotelAccess[] = rows
    .map((h) => {
      const entry = access[h.id];
      const role = rolesById.get(entry.roleId);
      return {
        id: h.id,
        code: h.code,
        name: h.name,
        city: h.city,
        sortOrder: h.sortOrder,
        roleId: entry.roleId,
        roleName: ROLE_NAMES[entry.roleId] ?? entry.roleId,
        perms: role?.perms ?? { devices: 'none', floors: 'none', cctv: 'none', access: 'none' },
        sources: entry.sources,
      };
    })
    .sort((a, b) => a.sortOrder - b.sortOrder);

  return { access, hotels };
}

// Throws 403-style guard: returns true if the user can perform `level` on
// `resource` for the given hotel. Used by device/floor routes.
export function canAccess(
  ctx: UserContext,
  hotelId: string,
  resource: keyof RolePerms,
  level: 'read' | 'crud'
): boolean {
  const hotel = ctx.hotels.find((h) => h.id === hotelId);
  if (!hotel) return false;
  const have = hotel.perms[resource] ?? 'none';
  if (level === 'read') return have === 'read' || have === 'crud';
  return have === 'crud';
}

const RANK = { none: 0, read: 1, crud: 2 } as const;

// Highest permission level the user holds for a resource across ALL their
// properties. Access-control management is a global admin capability, so it is
// gated on this rather than on a single property.
export function maxPerm(ctx: UserContext, resource: keyof RolePerms): 'none' | 'read' | 'crud' {
  let best: 'none' | 'read' | 'crud' = 'none';
  for (const h of ctx.hotels) {
    const p = h.perms[resource] ?? 'none';
    if (RANK[p] > RANK[best]) best = p;
  }
  return best;
}
