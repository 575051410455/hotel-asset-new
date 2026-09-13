// The rule for which floor kind a device may sit on — cameras on CCTV floors,
// everything else on workstation floors.
import { describe, expect, test } from 'bun:test';
import { floorKindForDeviceType, floorMismatch } from '../src/lib/device-floor';

describe('floorKindForDeviceType', () => {
  test('an IP Camera belongs on a CCTV floor', () => {
    expect(floorKindForDeviceType('IP Camera')).toBe('cctv');
  });

  test('workstations and access points belong on a workstation floor', () => {
    for (const type of ['Desktop', 'All-in-One', 'Server', 'Access Point']) {
      expect(floorKindForDeviceType(type)).toBe('workstation');
    }
  });
});

describe('floorMismatch', () => {
  test('matching kinds are allowed', () => {
    expect(floorMismatch('IP Camera', 'cctv')).toBeNull();
    expect(floorMismatch('Desktop', 'workstation')).toBeNull();
    expect(floorMismatch('Access Point', 'workstation')).toBeNull();
  });

  test('a camera on a workstation floor is refused', () => {
    expect(floorMismatch('IP Camera', 'workstation')).toBe('A camera can only be placed on a CCTV floor.');
  });

  test('a non-camera on a CCTV floor is refused', () => {
    expect(floorMismatch('Desktop', 'cctv')).toBe('Only cameras can be placed on a CCTV floor.');
    expect(floorMismatch('Access Point', 'cctv')).toBe('Only cameras can be placed on a CCTV floor.');
  });
});
