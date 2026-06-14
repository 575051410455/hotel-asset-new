// Pure helper: serialize a floor's pins to a paste-ready config block, the
// IT-staff escape hatch for versioning pin layouts in code / moving them to
// another floor. Coordinates are rounded to 1 decimal. No React/DOM deps so it
// stays unit-testable.

export type ConfigPin = {
  computerName: string;
  name?: string | null;
  department?: string | null;
  x: number | null;
  y: number | null;
  dir?: number | null;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

export function buildPinConfig(pins: ConfigPin[], isCam: boolean): string {
  const rows = pins
    .filter((p) => p.x != null && p.y != null)
    .map((p) => {
      const o: Record<string, unknown> = {
        id: p.computerName,
        label: p.name || p.computerName,
        dept: p.department || '',
        x: round1(p.x as number),
        y: round1(p.y as number),
      };
      if (isCam && p.dir != null) o.dir = round1(p.dir);
      return o;
    });
  const body = rows.map((r) => '    ' + JSON.stringify(r)).join(',\n');
  return `pins: [\n${body}\n  ],`;
}
