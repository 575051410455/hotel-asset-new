// What a floor will accept as a new pin, and why it won't.
//
// Pure and UI-free so the rule lives in one testable place rather than as
// conditions spread through the map's JSX. The map renders whatever this
// returns; any future screen that places pins asks the same question here and
// cannot disagree with it.
//
// The rule that matters: a pin's coordinates are percentages measured against
// the floor's aspect ratio, which holds a placeholder until a floor plan is
// uploaded and the real ratio is computed. A pin dropped before then was placed
// on blank space against a guessed ratio, so it lands somewhere arbitrary once
// the plan arrives. Placement therefore requires a plan.

export type PlacementTab = 'ws' | 'ap' | 'cam';

export type PlacementOption = {
  tab: PlacementTab;
  /** Button label, e.g. "Add camera". */
  label: string;
  /** Used mid-sentence, e.g. "Click on the map to place a camera". */
  noun: string;
};

export type PlacementState =
  | { canPlace: true; options: PlacementOption[] }
  | { canPlace: false; options: []; reason: PlacementBlocker };

/**
 * Why placement is unavailable.
 * - `no-capability`: the viewer may not edit. The controls are hidden entirely —
 *   showing a disabled button would imply the floor is one upload away.
 * - `no-floor`: nothing is selected yet.
 * - `no-floor-plan`: the floor exists but has no plan. The controls are shown
 *   disabled, because the capability is real and one upload away.
 */
export type PlacementBlocker = 'no-capability' | 'no-floor' | 'no-floor-plan';

const CAMERA: PlacementOption = { tab: 'cam', label: 'Add camera', noun: 'a camera' };
const WORKSTATION: PlacementOption = { tab: 'ws', label: 'Add workstation', noun: 'a workstation' };
const ACCESS_POINT: PlacementOption = { tab: 'ap', label: 'Add AP', noun: 'an access point' };

/** The floor fields this decision reads. Kept minimal so callers can pass a row. */
export type PlaceableFloor = {
  kind: string;
  image: string | null;
};

export function placementState(
  floor: PlaceableFloor | null | undefined,
  canEdit: boolean
): PlacementState {
  if (!canEdit) return { canPlace: false, options: [], reason: 'no-capability' };
  if (!floor) return { canPlace: false, options: [], reason: 'no-floor' };
  if (!floor.image) return { canPlace: false, options: [], reason: 'no-floor-plan' };

  // A floor's kind decides what belongs on it, and the two sets never mix.
  return {
    canPlace: true,
    options: floor.kind === 'cctv' ? [CAMERA] : [WORKSTATION, ACCESS_POINT],
  };
}

/**
 * The options to render. A blocked floor still renders its buttons — disabled —
 * so the capability stays discoverable, except when the viewer may not edit at
 * all, where nothing is shown.
 */
export function placementOptionsToRender(
  floor: PlaceableFloor | null | undefined,
  canEdit: boolean
): PlacementOption[] {
  const state = placementState(floor, canEdit);
  if (state.canPlace) return state.options;
  if (state.reason === 'no-capability') return [];
  return floor?.kind === 'cctv' ? [CAMERA] : [WORKSTATION, ACCESS_POINT];
}

/**
 * What to tell someone looking at a floor with nothing on it.
 *
 * Driven by the same decision as the buttons, so the map can never instruct a
 * viewer to press a control that is hidden from them, or point at a floor that
 * doesn't exist. Floor absence is reported before capability, because "there
 * are no floors" is the more useful fact even to someone who couldn't act on it.
 */
export function emptyFloorGuidance(
  floor: PlaceableFloor | null | undefined,
  canEdit: boolean,
  kind: 'workstation' | 'cctv'
): string {
  if (!floor) {
    return canEdit
      ? 'No floors yet for this property — create one to start placing pins.'
      : 'No floors have been set up for this property yet.';
  }

  const state = placementState(floor, canEdit);
  if (state.canPlace) {
    const first = state.options[0];
    return `Use ${first.label} to place the first pin.`;
  }

  switch (state.reason) {
    case 'no-floor-plan':
      return canEdit
        ? 'Upload a floor plan for this floor, then place pins on it.'
        : 'This floor has no floor plan yet.';
    case 'no-capability':
      return kind === 'cctv'
        ? 'No cameras have been placed on this floor yet.'
        : 'No devices have been placed on this floor yet.';
    case 'no-floor':
      return 'Select a floor first.';
  }
}

/** Tooltip for a placement button, explaining a blocked one rather than staying silent. */
export function placementHint(
  floor: PlaceableFloor | null | undefined,
  canEdit: boolean,
  option: PlacementOption
): string {
  const state = placementState(floor, canEdit);
  if (state.canPlace) return `Click on the map to place ${option.noun}`;
  switch (state.reason) {
    case 'no-floor-plan':
      return 'Upload a floor plan first — pins need a plan to sit on.';
    case 'no-floor':
      return 'Select a floor first.';
    case 'no-capability':
      return '';
  }
}
