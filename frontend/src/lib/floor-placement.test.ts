// Run with: bun test  (from frontend/). Excluded from the tsc build.
import { describe, expect, test } from 'bun:test';
import {
  placementState,
  placementOptionsToRender,
  placementHint,
  emptyFloorGuidance,
  type PlaceableFloor,
} from './floor-placement';

const cctv: PlaceableFloor = { kind: 'cctv', image: '/uploads/plan.png' };
const workstation: PlaceableFloor = { kind: 'workstation', image: '/uploads/plan.png' };
const planless: PlaceableFloor = { kind: 'cctv', image: null };

describe('placementState', () => {
  test('a CCTV floor with a plan accepts cameras only', () => {
    const state = placementState(cctv, true);
    expect(state.canPlace).toBe(true);
    expect(state.options.map((o) => o.tab)).toEqual(['cam']);
  });

  test('a workstation floor with a plan accepts workstations and access points, never cameras', () => {
    const state = placementState(workstation, true);
    expect(state.canPlace).toBe(true);
    expect(state.options.map((o) => o.tab)).toEqual(['ws', 'ap']);
    expect(state.options.map((o) => o.tab)).not.toContain('cam');
  });

  test('a floor with no plan accepts nothing, blocked on the missing plan', () => {
    const state = placementState(planless, true);
    expect(state.canPlace).toBe(false);
    expect(state.options).toEqual([]);
    expect(state.canPlace === false && state.reason).toBe('no-floor-plan');
  });

  test('no floor selected is blocked, and distinguishable from a missing plan', () => {
    const state = placementState(null, true);
    expect(state.canPlace).toBe(false);
    expect(state.canPlace === false && state.reason).toBe('no-floor');
  });

  test('without the edit capability nothing is placeable, whatever the floor', () => {
    for (const floor of [cctv, workstation, planless, null]) {
      const state = placementState(floor, false);
      expect(state.canPlace).toBe(false);
      expect(state.canPlace === false && state.reason).toBe('no-capability');
    }
  });

  test('the capability blocker outranks the missing plan, so the UI hides rather than teases', () => {
    const state = placementState(planless, false);
    expect(state.canPlace === false && state.reason).toBe('no-capability');
  });
});

describe('placementOptionsToRender', () => {
  test('a plan-less floor still renders its buttons, so the capability stays discoverable', () => {
    expect(placementOptionsToRender(planless, true).map((o) => o.tab)).toEqual(['cam']);
    expect(placementOptionsToRender({ kind: 'workstation', image: null }, true).map((o) => o.tab)).toEqual([
      'ws',
      'ap',
    ]);
  });

  test('without the edit capability nothing renders at all', () => {
    expect(placementOptionsToRender(cctv, false)).toEqual([]);
    expect(placementOptionsToRender(planless, false)).toEqual([]);
  });

  test('the rendered options match what a placeable floor would accept', () => {
    expect(placementOptionsToRender(cctv, true)).toEqual(placementState(cctv, true).options);
  });
});

describe('emptyFloorGuidance', () => {
  test('a placeable floor names the button that actually exists', () => {
    expect(emptyFloorGuidance(cctv, true, 'cctv')).toBe('Use Add camera to place the first pin.');
    expect(emptyFloorGuidance(workstation, true, 'workstation')).toBe(
      'Use Add workstation to place the first pin.'
    );
  });

  test('a plan-less floor asks for the plan rather than for a pin', () => {
    expect(emptyFloorGuidance(planless, true, 'cctv')).toContain('Upload a floor plan');
  });

  test('never tells a viewer to press a control they do not have', () => {
    for (const floor of [cctv, workstation, planless]) {
      const text = emptyFloorGuidance(floor, false, 'cctv');
      expect(text).not.toContain('Use Add');
      expect(text).not.toContain('Upload');
    }
  });

  test('no floor at all is reported as such, not as an empty floor', () => {
    expect(emptyFloorGuidance(null, true, 'cctv')).toContain('No floors yet');
    expect(emptyFloorGuidance(null, false, 'cctv')).toContain('No floors have been set up');
    // Crucially, it must not send the user after a button for a floor that
    // doesn't exist — the bug this function was extracted to prevent.
    expect(emptyFloorGuidance(null, true, 'cctv')).not.toContain('Add camera');
  });

  test('the guidance agrees with what the buttons do', () => {
    // If it names a button, that button must be enabled; if it doesn't, the
    // floor must genuinely be unplaceable.
    for (const floor of [cctv, workstation, planless, null]) {
      for (const canEdit of [true, false]) {
        const text = emptyFloorGuidance(floor, canEdit, 'cctv');
        const placeable = placementState(floor, canEdit).canPlace;
        expect(text.startsWith('Use Add')).toBe(placeable);
      }
    }
  });
});

describe('placementHint', () => {
  const camera = placementState(cctv, true).options[0];

  test('a placeable floor explains how to place', () => {
    expect(placementHint(cctv, true, camera)).toContain('Click on the map');
    expect(placementHint(cctv, true, camera)).toContain('a camera');
  });

  test('a plan-less floor explains what is missing rather than staying silent', () => {
    const hint = placementHint(planless, true, camera);
    expect(hint).toContain('floor plan');
    expect(hint).not.toContain('Click on the map');
  });

  test('no floor selected says so', () => {
    expect(placementHint(null, true, camera)).toContain('Select a floor');
  });
});
