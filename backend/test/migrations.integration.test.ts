// Migration seam: the checked-in migrations and the runner, exercised against
// throwaway databases created on the configured Postgres server (never the
// application database itself). Each test gets its own `zz_test_migrate_*`
// database and drops it afterwards.
//
// Skipped (not failed) when the server is unreachable or the configured role
// cannot create databases, like the other integration suites.
import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import postgres from 'postgres';
import { runMigrations, MIGRATIONS_DIR } from '../src/db/migrate';

const baseUrl = process.env.DATABASE_URL;
const journal = JSON.parse(fs.readFileSync(`${MIGRATIONS_DIR}/meta/_journal.json`, 'utf8')) as {
  entries: { tag: string }[];
};
const TOTAL = journal.entries.length;

let maintenanceUrl = '';
let available = false;
if (baseUrl) {
  const u = new URL(baseUrl);
  u.pathname = '/postgres';
  maintenanceUrl = u.toString();
  const probe = postgres(maintenanceUrl, { max: 1, connect_timeout: 3, onnotice: () => {} });
  try {
    const [{ can }] = await probe`select rolcreatedb or rolsuper as can from pg_roles where rolname = current_user`;
    available = !!can;
  } catch {
    available = false;
  } finally {
    await probe.end({ timeout: 1 });
  }
}

const created: string[] = [];

async function freshDatabase(): Promise<string> {
  const name = `zz_test_migrate_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const admin = postgres(maintenanceUrl, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`create database "${name}"`);
  } finally {
    await admin.end({ timeout: 1 });
  }
  created.push(name);
  const u = new URL(baseUrl!);
  u.pathname = `/${name}`;
  return u.toString();
}

// Apply migration files by hand, without history — the shape `db:push` left.
async function applyWithoutHistory(url: string, tags: string[]) {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    for (const tag of tags) {
      const body = fs.readFileSync(`${MIGRATIONS_DIR}/${tag}.sql`, 'utf8');
      for (const stmt of body.split('--> statement-breakpoint')) {
        if (stmt.trim()) await sql.unsafe(stmt);
      }
    }
  } finally {
    await sql.end({ timeout: 1 });
  }
}

async function withSql<T>(url: string, fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    return await fn(sql);
  } finally {
    await sql.end({ timeout: 1 });
  }
}

// The error message a query fails with, or null if it succeeds. postgres-js
// queries only run once awaited, and bun's `expect(...).rejects` never awaits
// them — it hangs — so failures are captured this way instead.
async function errorOf(query: PromiseLike<unknown>): Promise<string | null> {
  try {
    await query;
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

const tablesOf = (url: string) =>
  withSql(url, async (sql) =>
    (await sql`select table_name from information_schema.tables where table_schema = 'public'`).map(
      (r) => r.table_name as string
    )
  );

const historyOf = (url: string) =>
  withSql(url, async (sql) => {
    const [{ present }] = await sql`select to_regclass('drizzle.__drizzle_migrations') is not null as present`;
    if (!present) return 0;
    const [{ n }] = await sql`select count(*)::int as n from drizzle.__drizzle_migrations`;
    return n as number;
  });

afterAll(async () => {
  if (!created.length) return;
  const admin = postgres(maintenanceUrl, { max: 1, onnotice: () => {} });
  try {
    for (const name of created) await admin.unsafe(`drop database if exists "${name}" with (force)`);
  } finally {
    await admin.end({ timeout: 1 });
  }
});

const suite = available ? describe : describe.skip;

suite('database migrations (integration)', () => {
  test('a fresh database migrates to the full schema, and a second run changes nothing', async () => {
    const url = await freshDatabase();

    expect(await runMigrations(url)).toEqual({ baselined: 0, applied: TOTAL });
    const tables = await tablesOf(url);
    for (const t of ['users', 'floors', 'devices', 'sessions', 'audit_events', 'rate_limit_buckets', 'break_glass_mfa', 'recovery_codes']) {
      expect(tables).toContain(t);
    }

    expect(await runMigrations(url)).toEqual({ baselined: 0, applied: 0 });
    expect(await historyOf(url)).toBe(TOTAL);
  });

  test('a db:push-built database is baselined, keeps its data, and receives only the new migrations', async () => {
    const url = await freshDatabase();
    await applyWithoutHistory(url, ['0000_nifty_earthquake', '0001_google_identity_columns']);
    await withSql(url, (sql) => sql`insert into users (email, name) values ('kept@example.invalid', 'Kept')`);

    expect(await runMigrations(url)).toEqual({ baselined: 2, applied: TOTAL - 2 });
    expect(await historyOf(url)).toBe(TOTAL);

    const [kept] = await withSql(url, (sql) => sql`select email, status, platform_admin, version from users`);
    expect(kept).toEqual({ email: 'kept@example.invalid', status: 'active', platform_admin: false, version: 1 });
  });

  test('a database pushed before Google sign-in is baselined at 0000 and then gains the Google columns', async () => {
    const url = await freshDatabase();
    await applyWithoutHistory(url, ['0000_nifty_earthquake']);

    expect(await runMigrations(url)).toEqual({ baselined: 1, applied: TOTAL - 1 });
    const cols = await withSql(url, (sql) =>
      sql`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'users'`
    );
    expect(cols.map((c) => c.column_name)).toContain('google_sub');
  });

  test('a half-built database is refused rather than recorded as migrated', async () => {
    const url = await freshDatabase();
    await withSql(url, (sql) => sql`create table users (id serial primary key)`);

    await expect(runMigrations(url)).rejects.toThrow('Refusing to baseline');
    expect(await historyOf(url)).toBe(0);
  });

  test('audit events are append-only: updates, truncation and ordinary deletes are refused', async () => {
    const url = await freshDatabase();
    await runMigrations(url);

    await withSql(url, async (sql) => {
      await sql`insert into audit_events (event_type, outcome) values ('login', 'success')`;
      expect(await errorOf(sql`update audit_events set outcome = 'failure'`)).toContain('append-only');
      expect(await errorOf(sql`delete from audit_events`)).toContain('append-only');
      expect(await errorOf(sql`truncate audit_events`)).toContain('append-only');

      // Only the retention purge, which opts in for its own transaction, may delete.
      await sql.begin(async (tx) => {
        await tx`select set_config('ops.audit_retention_purge', 'on', true)`;
        await tx`delete from audit_events`;
      });
      const [{ n }] = await sql`select count(*)::int as n from audit_events`;
      expect(n).toBe(0);
    });
  });

  test('account status accepts archived and rejects anything outside the lifecycle', async () => {
    const url = await freshDatabase();
    await runMigrations(url);

    await withSql(url, async (sql) => {
      await sql`insert into users (email, name, status) values ('a@example.invalid', 'A', 'archived')`;
      expect(
        await errorOf(sql`insert into users (email, name, status) values ('b@example.invalid', 'B', 'deleted')`)
      ).toContain('users_status_check');
    });
  });
});
