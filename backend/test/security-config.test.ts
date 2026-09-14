// Startup seam: the security configuration is evaluated in a real subprocess,
// so a bad value must stop the process before anything else runs. Values are
// set inside the child before the import, because Bun would otherwise fill a
// missing variable from backend/.env.
import { describe, expect, test } from 'bun:test';

function start(frontendUrl: string | undefined, nodeEnv = 'development') {
  const assign = frontendUrl === undefined
    ? 'delete process.env.FRONTEND_URL;'
    : `process.env.FRONTEND_URL = ${JSON.stringify(frontendUrl)};`;
  const source = `${assign} process.env.NODE_ENV = ${JSON.stringify(nodeEnv)}; ` +
    "const m = await import('./src/lib/security-config.ts'); console.log(JSON.stringify(m.publicOrigin));";
  return Bun.spawnSync([process.execPath, '-e', source], { cwd: import.meta.dir + '/..', env: { ...process.env } });
}

describe('security configuration startup', () => {
  const rejected: [string, string | undefined][] = [
    ['missing', undefined],
    ['empty', ''],
    ['not a URL', 'localhost:5173'],
    ['a non-web scheme', 'ftp://ops.example.com'],
    ['a path', 'https://ops.example.com/app'],
    ['embedded credentials', 'https://operator:hunter2@ops.example.com'],
  ];
  for (const [label, value] of rejected) {
    test(`refuses to start with ${label} FRONTEND_URL, without echoing it`, () => {
      const result = start(value);
      const stderr = result.stderr.toString();
      expect(result.exitCode).not.toBe(0);
      expect(stderr).toContain('FRONTEND_URL must');
      if (value) expect(stderr).not.toContain(value);
    });
  }

  test('refuses plain HTTP to another machine, even in development', () => {
    const result = start('http://192.168.1.20');
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain('FRONTEND_URL must use https, except for local development');
  });

  test('refuses plain HTTP in production, even on localhost', () => {
    const result = start('http://localhost', 'production');
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain('FRONTEND_URL must use https, except for local development');
  });

  test('accepts an HTTPS origin in production and marks cookies Secure', () => {
    const result = start('https://ops.example.com/', 'production');
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.toString())).toEqual({ origin: 'https://ops.example.com', secureCookies: true });
  });

  test('accepts plain HTTP on localhost for development, without Secure cookies', () => {
    const result = start(' http://localhost:5173 ');
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.toString())).toEqual({ origin: 'http://localhost:5173', secureCookies: false });
  });
});
