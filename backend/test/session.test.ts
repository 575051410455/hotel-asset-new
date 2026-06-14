// Pure unit tests for the per-request access guards used by every route.
import { describe, expect, test } from 'bun:test';
import { canAccess, maxPerm, type UserContext, type HotelAccess } from '../src/lib/session';
import type { RolePerms } from '../src/db/schema';

const ADMIN: RolePerms = { devices: 'crud', floors: 'crud', cctv: 'crud', access: 'crud' };
const VIEWER: RolePerms = { devices: 'read', floors: 'read', cctv: 'read', access: 'none' };

function hotel(id: string, roleId: string, perms: RolePerms): HotelAccess {
  return {
    id,
    code: id.toUpperCase(),
    name: `Hotel ${id}`,
    city: 'Testville',
    sortOrder: 0,
    roleId,
    roleName: roleId,
    perms,
    sources: ['direct'],
  };
}

// admin on rh2, viewer on rh3, no access to rbr.
const ctx: UserContext = {
  access: {},
  hotels: [hotel('rh2', 'admin', ADMIN), hotel('rh3', 'viewer', VIEWER)],
};

describe('canAccess', () => {
  test('crud implies read', () => {
    expect(canAccess(ctx, 'rh2', 'floors', 'read')).toBe(true);
    expect(canAccess(ctx, 'rh2', 'floors', 'crud')).toBe(true);
  });

  test('read does not imply crud', () => {
    expect(canAccess(ctx, 'rh3', 'floors', 'read')).toBe(true);
    expect(canAccess(ctx, 'rh3', 'floors', 'crud')).toBe(false);
  });

  test('a property the user cannot reach is always denied', () => {
    expect(canAccess(ctx, 'rbr', 'devices', 'read')).toBe(false);
    expect(canAccess(ctx, 'rbr', 'devices', 'crud')).toBe(false);
  });

  test('floor creation (floors:crud) is the gate the wizard relies on', () => {
    // Mirrors POST /api/floors + POST /api/uploads server-side checks.
    expect(canAccess(ctx, 'rh2', 'floors', 'crud')).toBe(true); // admin can add a floor
    expect(canAccess(ctx, 'rh3', 'floors', 'crud')).toBe(false); // viewer cannot
  });

  test('cctv-kind floor reads are gated on the cctv resource', () => {
    expect(canAccess(ctx, 'rh3', 'cctv', 'read')).toBe(true);
    expect(canAccess(ctx, 'rh3', 'cctv', 'crud')).toBe(false);
  });
});

describe('maxPerm', () => {
  test('returns the strongest level held across all properties', () => {
    expect(maxPerm(ctx, 'access')).toBe('crud'); // via admin@rh2
    expect(maxPerm(ctx, 'devices')).toBe('crud');
  });

  test('returns none when no property grants the resource', () => {
    const viewerOnly: UserContext = { access: {}, hotels: [hotel('rh3', 'viewer', VIEWER)] };
    expect(maxPerm(viewerOnly, 'access')).toBe('none');
    expect(maxPerm(viewerOnly, 'floors')).toBe('read');
  });

  test('an empty context has no permissions', () => {
    const empty: UserContext = { access: {}, hotels: [] };
    expect(maxPerm(empty, 'devices')).toBe('none');
  });
});
