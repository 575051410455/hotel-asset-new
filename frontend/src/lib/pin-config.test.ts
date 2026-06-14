// Run with: bun test  (from frontend/). Excluded from the tsc build.
import { describe, expect, test } from 'bun:test';
import { buildPinConfig } from './pin-config';

describe('buildPinConfig (Copy config output shape)', () => {
  test('emits a pins: [...] block with id/label/dept and 1-decimal coords', () => {
    const out = buildPinConfig(
      [{ computerName: 'ACC-PC-01', name: 'Suda K.', department: 'AP', x: 42.58, y: 30.12 }],
      false
    );
    expect(out.startsWith('pins: [')).toBe(true);
    expect(out.trimEnd().endsWith('],')).toBe(true);
    expect(out).toContain('"id":"ACC-PC-01"');
    expect(out).toContain('"label":"Suda K."');
    expect(out).toContain('"dept":"AP"');
    expect(out).toContain('"x":42.6'); // 42.58 → 42.6
    expect(out).toContain('"y":30.1'); // 30.12 → 30.1
  });

  test('falls back label→id and dept→empty string', () => {
    const out = buildPinConfig([{ computerName: 'CAM-1', name: null, department: null, x: 10, y: 20 }], true);
    expect(out).toContain('"label":"CAM-1"');
    expect(out).toContain('"dept":""');
  });

  test('includes dir only for cameras', () => {
    expect(buildPinConfig([{ computerName: 'CAM-1', x: 1, y: 2, dir: 90 }], true)).toContain('"dir":90');
    expect(buildPinConfig([{ computerName: 'PC-1', x: 1, y: 2, dir: 90 }], false)).not.toContain('dir');
  });

  test('skips pins that have no coordinates', () => {
    const out = buildPinConfig(
      [
        { computerName: 'PLACED', x: 5, y: 6 },
        { computerName: 'UNPLACED', x: null, y: null },
      ],
      false
    );
    expect(out).toContain('"id":"PLACED"');
    expect(out).not.toContain('UNPLACED');
  });
});
