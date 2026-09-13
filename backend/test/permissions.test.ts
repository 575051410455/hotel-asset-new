// The `access` → `userManagement` permission rename, read side: every stored or
// submitted role is normalised here before anything decides authority from it.
import { describe, expect, test } from 'bun:test';
import { normalizeRolePerms, withLegacyAccessKey, PERM_RESOURCES } from '../src/lib/permissions';
import { roleRank } from '../src/lib/rbac';

describe('normalizeRolePerms', () => {
  test('reads the legacy access key as userManagement at the same level', () => {
    for (const lv of ['none', 'read', 'crud'] as const) {
      expect(normalizeRolePerms({ devices: 'read', floors: 'read', cctv: 'read', access: lv }).userManagement).toBe(lv);
    }
  });

  test('prefers the new key when a role carries both', () => {
    expect(normalizeRolePerms({ userManagement: 'read', access: 'crud' }).userManagement).toBe('read');
  });

  test('a role with neither key has no User Management permission, never CRUD', () => {
    expect(normalizeRolePerms({ devices: 'crud', floors: 'crud', cctv: 'crud' }).userManagement).toBe('none');
  });

  test('unrecognised levels and missing roles normalise to none', () => {
    const odd = normalizeRolePerms({ devices: 'owner', access: 'admin' } as never);
    expect(odd).toEqual({ devices: 'none', floors: 'none', cctv: 'none', userManagement: 'none' });
    expect(normalizeRolePerms(null)).toEqual({ devices: 'none', floors: 'none', cctv: 'none', userManagement: 'none' });
  });

  test('carries only canonical resources, so a role is never ranked on the permission twice', () => {
    const both = normalizeRolePerms({ devices: 'crud', floors: 'crud', cctv: 'crud', access: 'crud', userManagement: 'crud' });
    expect(Object.keys(both).sort()).toEqual([...PERM_RESOURCES].sort());
    expect(roleRank(both)).toBe(8);
  });
});

describe('withLegacyAccessKey', () => {
  test('mirrors userManagement into access for readers on the previous release', () => {
    expect(withLegacyAccessKey({ devices: 'read', floors: 'none', cctv: 'none', userManagement: 'read' })).toEqual({
      devices: 'read', floors: 'none', cctv: 'none', userManagement: 'read', access: 'read',
    });
  });
});
