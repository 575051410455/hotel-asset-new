// Applies the checked-in migrations in backend/drizzle. This replaces
// `drizzle-kit push`, which rewrote the live schema to match schema.ts with no
// reviewable history.
//
// Databases created before this runner were built with `db:push`: they hold the
// tables but no migration history, so the migrator would replay 0000's CREATE
// TABLEs and fail. Such a database is baselined first — the migrations its shape
// already contains are recorded as applied — but only after checking the shape
// really matches them. A half-built or drifted database stops with an error
// instead of being recorded as something it isn't.
//
// Run:  bun run db:migrate          (prod) docker compose exec backend bun run db:migrate
import path from 'node:path';
import fs from 'node:fs';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';

export const MIGRATIONS_DIR = path.resolve(import.meta.dir, '../../drizzle');

// Tables created by 0000. A push-built database has all of them.
const INITIAL_TABLES = [
  'assignments', 'devices', 'floors', 'group_hotels', 'group_members',
  'groups', 'hotels', 'roles', 'users',
];
// Tables that only arrive through later migrations. If a history-less database
// already has any of them, it was pushed from a newer schema and can't be
// baselined safely by shape alone.
const LATER_TABLES = ['sessions', 'audit_events', 'rate_limit_buckets', 'break_glass_mfa', 'recovery_codes'];

const BASELINE_TAGS = ['0000_nifty_earthquake', '0001_google_identity_columns'] as const;

// Serialises concurrent runners (two containers starting at once).
const LOCK_KEY = 72_410_001;

export type MigrationResult = { baselined: number; applied: number };

async function historyCount(sql: postgres.Sql): Promise<number> {
  const [{ present }] = await sql`select to_regclass('drizzle.__drizzle_migrations') is not null as present`;
  if (!present) return 0;
  const [{ n }] = await sql`select count(*)::int as n from drizzle.__drizzle_migrations`;
  return n;
}

// How many of the baseline migrations a history-less database already contains.
async function pushBuiltShape(sql: postgres.Sql): Promise<number> {
  const rows = await sql`select table_name from information_schema.tables where table_schema = 'public'`;
  const tables = new Set(rows.map((r) => r.table_name as string));

  const initial = INITIAL_TABLES.filter((t) => tables.has(t));
  if (initial.length === 0) return 0; // a fresh database: migrate from the start
  if (initial.length !== INITIAL_TABLES.length) {
    const missing = INITIAL_TABLES.filter((t) => !tables.has(t));
    throw new Error(`Refusing to baseline: the database has only some application tables (missing ${missing.join(', ')}). Inspect it by hand.`);
  }
  const later = LATER_TABLES.filter((t) => tables.has(t));
  if (later.length) {
    throw new Error(`Refusing to baseline: tables from a later migration already exist without history (${later.join(', ')}). Inspect it by hand.`);
  }

  // 0001: Google sign-in columns, and a password that may be absent.
  const cols = await sql`
    select column_name, is_nullable from information_schema.columns
    where table_schema = 'public' and table_name = 'users'`;
  const byName = new Map(cols.map((c) => [c.column_name as string, c.is_nullable as string]));
  const googleParts = [byName.has('google_sub'), byName.has('avatar'), byName.get('password_hash') === 'YES'];
  if (googleParts.every(Boolean)) return 2;
  if (googleParts.some(Boolean)) {
    throw new Error('Refusing to baseline: users has only part of the Google sign-in columns. Inspect it by hand.');
  }
  return 1;
}

async function recordBaseline(sql: postgres.Sql, folder: string, count: number) {
  const journal = JSON.parse(fs.readFileSync(`${folder}/meta/_journal.json`, 'utf8')) as {
    entries: { tag: string }[];
  };
  const tags = journal.entries.slice(0, count).map((e) => e.tag);
  if (tags.join() !== BASELINE_TAGS.slice(0, count).join()) {
    throw new Error(`Baseline migrations have changed (expected ${BASELINE_TAGS.slice(0, count).join(', ')}, found ${tags.join(', ')}).`);
  }
  const migrations = readMigrationFiles({ migrationsFolder: folder }).slice(0, count);
  await sql.begin(async (tx) => {
    await tx`create schema if not exists drizzle`;
    await tx`create table if not exists drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)`;
    for (const m of migrations) {
      await tx`insert into drizzle.__drizzle_migrations (hash, created_at) values (${m.hash}, ${m.folderMillis})`;
    }
  });
}

export async function runMigrations(url: string, folder = MIGRATIONS_DIR): Promise<MigrationResult> {
  // One connection, so the advisory lock and the migration share a session.
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql`select pg_advisory_lock(${LOCK_KEY})`;
    let baselined = 0;
    if ((await historyCount(sql)) === 0) {
      baselined = await pushBuiltShape(sql);
      if (baselined > 0) await recordBaseline(sql, folder, baselined);
    }
    const before = await historyCount(sql);
    await migrate(drizzle(sql), { migrationsFolder: folder });
    const applied = (await historyCount(sql)) - before;
    return { baselined, applied };
  } finally {
    await sql`select pg_advisory_unlock(${LOCK_KEY})`.catch(() => {});
    await sql.end({ timeout: 5 });
  }
}

if (import.meta.main) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  try {
    const { baselined, applied } = await runMigrations(url);
    if (baselined) console.log(`Baselined a db:push-built database: recorded ${baselined} existing migration(s) as applied.`);
    console.log(applied ? `Applied ${applied} migration(s).` : 'Database is up to date.');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
