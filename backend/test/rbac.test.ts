// Pure unit tests for the RBAC engine (no DB). These cover the merge logic that
// gates every device/floor/cctv route: access is per-property and, when several
// sources grant the same property, the STRONGEST role wins.
import { describe, expect, test } from 'bun:test';
import {
  permScore,
  roleRank,
  computeEffectiveAccess,
  bestPermFor,
  PERM_RESOURCES,
} from '../src/lib/rbac';
import type { RolePerms } from '../src/db/schema';

const ADMIN: RolePerms = { devices: 'crud', floors: 'crud', cctv: 'crud', access: 'crud' };
const MANAGER: RolePerms = { devices: 'crud', floors: 'crud', cctv: 'crud', access: 'none' };
const VIEWER: RolePerms = { devices: 'read', floors: 'read', cctv: 'read', access: 'none' };

const rolesById = new Map([
  ['admin', { id: 'admin', perms: ADMIN }],
  ['manager', { id: 'manager', perms: MANAGER }],
  ['viewer', { id: 'viewer', perms: VIEWER }],
]);

describe('permScore', () => {
  test('ranks levels none < read < crud', () => {
    expect(permScore('none')).toBe(0);
    expect(permScore('read')).toBe(1);
    expect(permScore('crud')).toBe(2);
  });
  test('treats undefined as none', () => {
    expect(permScore(undefined)).toBe(0);
  });
});

describe('roleRank', () => {
  test('sums perm scores across all resources', () => {
    expect(roleRank(ADMIN)).toBe(8); // 2*4
    expect(roleRank(MANAGER)).toBe(6); // crud×3 + none
    expect(roleRank(VIEWER)).toBe(3); // read×3 + none
  });
  test('admin outranks manager outranks viewer', () => {
    expect(roleRank(ADMIN)).toBeGreaterThan(roleRank(MANAGER));
    expect(roleRank(MANAGER)).toBeGreaterThan(roleRank(VIEWER));
  });
});

describe('computeEffectiveAccess', () => {
  test('a single direct assignment grants that role', () => {
    const acc = computeEffectiveAccess(rolesById, [{ hotelId: 'rh2', roleId: 'viewer' }], []);
    expect(acc.rh2.roleId).toBe('viewer');
    expect(acc.rh2.sources).toEqual(['direct']);
  });

  test('a single group grant records its source', () => {
    const acc = computeEffectiveAccess(rolesById, [], [
      { hotelId: 'rh2', roleId: 'manager', groupName: 'IT Operations' },
    ]);
    expect(acc.rh2.roleId).toBe('manager');
    expect(acc.rh2.sources).toEqual(['group:IT Operations']);
  });

  test('strongest role wins when a stronger group grant follows a weaker direct one', () => {
    const acc = computeEffectiveAccess(
      rolesById,
      [{ hotelId: 'rh2', roleId: 'viewer' }],
      [{ hotelId: 'rh2', roleId: 'admin', groupName: 'IT Operations' }]
    );
    expect(acc.rh2.roleId).toBe('admin');
    expect(acc.rh2.sources).toEqual(['direct', 'group:IT Operations']);
  });

  test('a stronger direct role is not downgraded by a weaker group grant', () => {
    const acc = computeEffectiveAccess(
      rolesById,
      [{ hotelId: 'rh2', roleId: 'admin' }],
      [{ hotelId: 'rh2', roleId: 'viewer', groupName: 'Front Office' }]
    );
    expect(acc.rh2.roleId).toBe('admin');
    expect(acc.rh2.sources).toEqual(['direct', 'group:Front Office']);
  });

  test('keeps per-property access independent', () => {
    const acc = computeEffectiveAccess(
      rolesById,
      [{ hotelId: 'rh2', roleId: 'admin' }],
      [{ hotelId: 'rh3', roleId: 'viewer', groupName: 'Front Office' }]
    );
    expect(acc.rh2.roleId).toBe('admin');
    expect(acc.rh3.roleId).toBe('viewer');
    expect(Object.keys(acc).sort()).toEqual(['rh2', 'rh3']);
  });
});

describe('bestPermFor', () => {
  const access = computeEffectiveAccess(
    rolesById,
    [
      { hotelId: 'rh2', roleId: 'admin' },
      { hotelId: 'rh3', roleId: 'viewer' },
    ],
    []
  );

  test('returns the highest level across all properties', () => {
    expect(bestPermFor(access, rolesById, 'access')).toBe('crud'); // only via admin@rh2
    expect(bestPermFor(access, rolesById, 'devices')).toBe('crud');
  });

  test('scopes to a single property when given', () => {
    expect(bestPermFor(access, rolesById, 'access', 'rh3')).toBe('none'); // viewer has no access perm
    expect(bestPermFor(access, rolesById, 'devices', 'rh3')).toBe('read');
    expect(bestPermFor(access, rolesById, 'floors', 'rh2')).toBe('crud');
  });

  test('returns none for an unknown property', () => {
    expect(bestPermFor(access, rolesById, 'devices', 'nope')).toBe('none');
  });
});

test('PERM_RESOURCES is the canonical resource list', () => {
  expect([...PERM_RESOURCES]).toEqual(['devices', 'floors', 'cctv', 'access']);
});
