// Creates the application's database (default: opsmonitor) on the configured
// Postgres server if it does not already exist. We connect to the server's
// maintenance database ("postgres") to issue CREATE DATABASE, then exit.
//
// Run with: bun run db:create
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required (see .env)');
  process.exit(1);
}

const parsed = new URL(url);
const dbName = parsed.pathname.replace(/^\//, '') || 'opsmonitor';

// Point the same credentials at the maintenance "postgres" database.
const adminUrl = new URL(url);
adminUrl.pathname = '/postgres';

const sql = postgres(adminUrl.toString());

try {
  const existing = await sql`
    SELECT 1 FROM pg_database WHERE datname = ${dbName}
  `;
  if (existing.length > 0) {
    console.log(`Database "${dbName}" already exists — nothing to do.`);
  } else {
    // Identifier can't be parameterized; dbName comes from our own env.
    await sql.unsafe(`CREATE DATABASE "${dbName}"`);
    console.log(`Created database "${dbName}".`);
  }
} catch (err) {
  console.error('Failed to create database:', err);
  process.exitCode = 1;
} finally {
  await sql.end();
}
