// Which floor kind a device belongs on.
//
// A floor's kind decides what it holds, and the two sets never mix: cameras go
// on CCTV floors; workstations and Wi-Fi access points go on workstation
// floors. The map UI only offers the matching Add buttons
// (frontend/src/lib/floor-placement.ts), but the API is the boundary that has
// to hold, so the device routes check every placement against this rule.

export type FloorKind = 'workstation' | 'cctv';

/** The device type the app treats as a camera (see isCameraDevice on the client). */
export const CAMERA_TYPE = 'IP Camera';

export function floorKindForDeviceType(type: string): FloorKind {
  return type === CAMERA_TYPE ? 'cctv' : 'workstation';
}

/** Why a device can't sit on a floor, or null when it can. */
export function floorMismatch(deviceType: string, floorKind: string): string | null {
  const needed = floorKindForDeviceType(deviceType);
  if (needed === floorKind) return null;
  return needed === 'cctv'
    ? 'A camera can only be placed on a CCTV floor.'
    : 'Only cameras can be placed on a CCTV floor.';
}
