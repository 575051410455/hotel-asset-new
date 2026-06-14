// Validation tests for the floor request schemas — the contract the create-floor
// wizard and the POST/PATCH /api/floors routes share.
import { describe, expect, test } from 'bun:test';
import { createFloorSchema, updateFloorSchema } from '../src/shared/types';

const base = {
  hotelId: 'rh2',
  id: 'accounting',
  name: 'Accounting Floor',
  short: '3F · Accounts',
  kind: 'workstation' as const,
};

describe('createFloorSchema', () => {
  test('accepts a minimal valid floor and defaults departments to []', () => {
    const parsed = createFloorSchema.parse(base);
    expect(parsed.departments).toEqual([]);
    expect(parsed.id).toBe('accounting');
    expect(parsed.kind).toBe('workstation');
  });

  test('passes through optional image/aspect/route and departments', () => {
    const parsed = createFloorSchema.parse({
      ...base,
      route: '/accounting',
      image: '/uploads/flr-abc.png',
      aspect: 0.75,
      departments: ['AP', 'AR', 'GL'],
    });
    expect(parsed.route).toBe('/accounting');
    expect(parsed.image).toBe('/uploads/flr-abc.png');
    expect(parsed.aspect).toBe(0.75);
    expect(parsed.departments).toEqual(['AP', 'AR', 'GL']);
  });

  describe('slug rules (lowercase letters, numbers, hyphens; ≤31; alnum start)', () => {
    test.each(['office', 'account-3f', '3f', 'a', 'a'.repeat(31)])('accepts %p', (id) => {
      expect(createFloorSchema.safeParse({ ...base, id }).success).toBe(true);
    });

    test.each([
      ['uppercase', 'Office'],
      ['leading hyphen', '-bad'],
      ['space', 'has space'],
      ['underscore', 'snake_case'],
      ['empty', ''],
      ['too long', 'a'.repeat(32)],
    ])('rejects %s (%p)', (_label, id) => {
      expect(createFloorSchema.safeParse({ ...base, id }).success).toBe(false);
    });
  });

  test('requires a non-empty name and short label', () => {
    expect(createFloorSchema.safeParse({ ...base, name: '' }).success).toBe(false);
    expect(createFloorSchema.safeParse({ ...base, short: '' }).success).toBe(false);
  });

  test('only allows workstation | cctv kinds', () => {
    expect(createFloorSchema.safeParse({ ...base, kind: 'cctv' }).success).toBe(true);
    expect(createFloorSchema.safeParse({ ...base, kind: 'rooftop' }).success).toBe(false);
  });

  test('rejects a non-positive or oversized aspect', () => {
    expect(createFloorSchema.safeParse({ ...base, aspect: 0 }).success).toBe(false);
    expect(createFloorSchema.safeParse({ ...base, aspect: 11 }).success).toBe(false);
  });

  test('allows a null image (no plan uploaded yet)', () => {
    expect(createFloorSchema.safeParse({ ...base, image: null }).success).toBe(true);
  });
});

describe('updateFloorSchema', () => {
  test('every field is optional (partial patch)', () => {
    expect(updateFloorSchema.safeParse({}).success).toBe(true);
    expect(updateFloorSchema.safeParse({ name: 'Renamed' }).success).toBe(true);
    expect(updateFloorSchema.safeParse({ departments: ['X'] }).success).toBe(true);
  });

  test('sortOrder must be an integer', () => {
    expect(updateFloorSchema.safeParse({ sortOrder: 3 }).success).toBe(true);
    expect(updateFloorSchema.safeParse({ sortOrder: 1.5 }).success).toBe(false);
  });

  test('still rejects an empty name when provided', () => {
    expect(updateFloorSchema.safeParse({ name: '' }).success).toBe(false);
  });
});
