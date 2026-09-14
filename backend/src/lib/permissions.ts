// Role permissions, and the `access` → `userManagement` key rename.
//
// Role permissions are persisted as JSON, so renaming the TypeScript property
// alone would make every existing administrator appear to have no User
// Management permission. The rename therefore runs expand/migrate/contract
// (docs/specs/security-hardening-and-user-management.md):
//
//   expand   — every reader goes through normalizeRolePerms, which accepts
//              either key; every writer stores both (withLegacyAccessKey).
//   migrate  — migration 0003 copies each role's exact level to the new key.
//   contract — later, stop writing `access`, drop it, and delete the fallback.
//
// A missing or unrecognised level always normalises to `none`, never CRUD.
import type { PermLevel, RolePerms, StoredRolePerms } from '../db/schema';

export const PERM_RESOURCES = ['devices', 'floors', 'cctv', 'userManagement'] as const;
export type Resource = (typeof PERM_RESOURCES)[number];

const LEVELS: ReadonlySet<string> = new Set(['none', 'read', 'crud']);
const level = (v: unknown): PermLevel => (typeof v === 'string' && LEVELS.has(v) ? (v as PermLevel) : 'none');

/**
 * The canonical permissions for a stored or submitted role. Reads
 * `userManagement`, falling back to the legacy `access` key. The result carries
 * only canonical resources, so nothing that sums over them counts this one twice.
 */
export function normalizeRolePerms(raw: StoredRolePerms | null | undefined): RolePerms {
  const p = raw ?? {};
  return {
    devices: level(p.devices),
    floors: level(p.floors),
    cctv: level(p.cctv),
    userManagement: level(p.userManagement ?? p.access),
  };
}

/** Permissions as written and returned during the overlap: canonical plus the legacy mirror. */
export type CompatRolePerms = RolePerms & { access: PermLevel };

export function withLegacyAccessKey(perms: RolePerms): CompatRolePerms {
  return { ...perms, access: perms.userManagement };
}
