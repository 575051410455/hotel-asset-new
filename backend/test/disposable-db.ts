// Throwaway, fully migrated databases on the configured Postgres server, for
// tests that must control every row — never the application database itself.
// Unavailable (tests skip) when the server is unreachable or the configured
// role cannot create databases.
import postgres from 'postgres';
import { runMigrations } from '../src/db/migrate';

const baseUrl = process.env.DATABASE_URL;
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

export const disposableDbAvailable = available;

const created: string[] = [];

export async function migratedDatabase(): Promise<string> {
  const name = `zz_test_disposable_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const admin = postgres(maintenanceUrl, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`create database "${name}"`);
  } finally {
    await admin.end({ timeout: 1 });
  }
  created.push(name);
  const u = new URL(baseUrl!);
  u.pathname = `/${name}`;
  const url = u.toString();
  await runMigrations(url);
  return url;
}

export async function dropDisposableDatabases() {
  if (!created.length) return;
  const admin = postgres(maintenanceUrl, { max: 1, onnotice: () => {} });
  try {
    for (const name of created.splice(0)) await admin.unsafe(`drop database if exists "${name}" with (force)`);
  } finally {
    await admin.end({ timeout: 1 });
  }
}
