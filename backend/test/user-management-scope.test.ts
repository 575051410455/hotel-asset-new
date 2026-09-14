// The User Management scope rules: Platform Administrators are unscoped;
// everyone else sees and changes only the hotels they hold the permission on.
import { describe, expect, test } from 'bun:test';
import {
  scopeFromHotelGrants,
  canReadUserManagement,
  canWriteUserManagement,
  hotelInScope,
  roleAssignable,
  userVisible,
  groupVisible,
  groupManageable,
  type ManagementScope,
} from '../src/lib/user-management-scope';

const platform: ManagementScope = { platform: true };
// CRUD on rh2, READ on rh3, nothing on rbr.
const hotelAdmin = scopeFromHotelGrants([
  { hotelId: 'rh2', level: 'crud' },
  { hotelId: 'rh3', level: 'read' },
  { hotelId: 'rbr', level: 'none' },
]);
const nobody = scopeFromHotelGrants([{ hotelId: 'rh2', level: 'none' }]);

describe('scopeFromHotelGrants', () => {
  test('READ hotels are in view, CRUD hotels are also changeable, NONE hotels are neither', () => {
    expect(hotelInScope(hotelAdmin, 'rh2', 'crud')).toBe(true);
    expect(hotelInScope(hotelAdmin, 'rh3', 'read')).toBe(true);
    expect(hotelInScope(hotelAdmin, 'rh3', 'crud')).toBe(false);
    expect(hotelInScope(hotelAdmin, 'rbr', 'read')).toBe(false);
  });

  test('without the permission anywhere there is no User Management at all', () => {
    expect(canReadUserManagement(nobody)).toBe(false);
    expect(canWriteUserManagement(nobody)).toBe(false);
    expect(canReadUserManagement(hotelAdmin)).toBe(true);
    expect(canWriteUserManagement(scopeFromHotelGrants([{ hotelId: 'rh3', level: 'read' }]))).toBe(false);
  });
});

describe('roleAssignable', () => {
  test('only a Platform Administrator may assign a role that carries User Management CRUD', () => {
    expect(roleAssignable(platform, { userManagement: 'crud' })).toBe(true);
    expect(roleAssignable(hotelAdmin, { userManagement: 'crud' })).toBe(false);
    expect(roleAssignable(hotelAdmin, { userManagement: 'read' })).toBe(true);
    expect(roleAssignable(hotelAdmin, { userManagement: 'none' })).toBe(true);
  });
});

describe('userVisible', () => {
  test('a person is visible when connected to any hotel in view, and never otherwise', () => {
    expect(userVisible(hotelAdmin, ['rbr', 'rh3'])).toBe(true);
    expect(userVisible(hotelAdmin, ['rbr'])).toBe(false);
    expect(userVisible(hotelAdmin, [])).toBe(false);
    expect(userVisible(platform, [])).toBe(true);
  });
});

describe('groups', () => {
  test('a group is visible only when all its hotels are in view, and manageable only when all are changeable', () => {
    expect(groupVisible(hotelAdmin, ['rh2', 'rh3'])).toBe(true);
    expect(groupManageable(hotelAdmin, ['rh2', 'rh3'])).toBe(false);
    expect(groupManageable(hotelAdmin, ['rh2'])).toBe(true);
    expect(groupVisible(hotelAdmin, ['rh2', 'rbr'])).toBe(false);
  });

  test('a group with no hotels belongs to the platform', () => {
    expect(groupVisible(hotelAdmin, [])).toBe(false);
    expect(groupManageable(platform, [])).toBe(true);
  });
});
