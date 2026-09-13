import { describe, expect, test } from 'bun:test';

describe('security configuration startup', () => {
  for (const secret of [undefined, '', 'short', 'change-this-to-a-long-random-string', 'example'.repeat(8)]) {
    test(`rejects ${secret === undefined ? 'missing' : secret === '' ? 'empty' : 'unsafe'} secret`, () => {
      const env = { ...process.env };
      if (secret === undefined) delete env.JWT_SECRET;
      else env.JWT_SECRET = secret;
      const source = (secret === undefined ? 'delete process.env.JWT_SECRET; ' : '') +
        "await import('./src/lib/security-config.ts')";
      const result = Bun.spawnSync([process.execPath, '-e', source], {
        cwd: import.meta.dir + '/..', env,
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr.toString()).toContain('JWT_SECRET must be');
    });
  }

  test('accepts a generated signing secret', () => {
    const result = Bun.spawnSync([process.execPath, '-e', "await import('./src/lib/security-config.ts')"], {
      cwd: import.meta.dir + '/..',
      env: { ...process.env, JWT_SECRET: crypto.randomUUID() + crypto.randomUUID() },
    });
    expect(result.exitCode).toBe(0);
  });
});
