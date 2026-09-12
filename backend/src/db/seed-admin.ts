// ─────────────────────────────────────────────────────────────────────────────
// Production bootstrap seed — creates ONLY what you need to sign in the first
// time. No demo hotels / floors / devices / users; you add everything else in
// the UI after logging in.
//
// It creates, idempotently (never deletes, skips rows that already exist):
//   1. the built-in `admin` role (full permissions)
//   2. one property           3. one admin user           4. admin's assignment
//
// Required env:  ADMIN_EMAIL, ADMIN_PASSWORD
// Optional env:  ADMIN_NAME, PROPERTY_ID, PROPERTY_CODE, PROPERTY_NAME, PROPERTY_CITY
//
// Run:  ADMIN_EMAIL=you@co.com ADMIN_PASSWORD='…' bun run db:seed:admin
//   (prod)  docker compose exec -e ADMIN_EMAIL=you@co.com -e ADMIN_PASSWORD='…' \
//             backend bun run db:seed:admin
// ─────────────────────────────────────────────────────────────────────────────
import bcrypt from 'bcryptjs';
import { and, eq } from 'drizzle-orm';
import { db } from './index';
import { roles, hotels, users, assignments, type RolePerms } from './schema';

const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;
if (!email || !password) {
  console.error('✖ ADMIN_EMAIL and ADMIN_PASSWORD are required.');
  console.error("  e.g.  ADMIN_EMAIL=you@company.com ADMIN_PASSWORD='StrongPass!' bun run db:seed:admin");
  process.exit(1);
}

const name = process.env.ADMIN_NAME?.trim() || 'Administrator';
const propertyId = process.env.PROPERTY_ID?.trim() || 'hq';
const propertyCode = process.env.PROPERTY_CODE?.trim() || 'HQ';
const propertyName = process.env.PROPERTY_NAME?.trim() || 'Head Office';
const propertyCity = process.env.PROPERTY_CITY?.trim() || '';

const ADMIN_PERMS: RolePerms = { devices: 'crud', floors: 'crud', cctv: 'crud', access: 'crud' };

async function seedAdmin() {
  console.log('Bootstrapping admin (no demo data)…');

  // 1. built-in admin role
  await db
    .insert(roles)
    .values({ id: 'admin', name: 'Administrator', description: 'Full control.', builtin: true, perms: ADMIN_PERMS })
    .onConflictDoNothing();

  // 2. one property to attach the admin to (login shows "No properties assigned"
  //    without at least one accessible property)
  await db
    .insert(hotels)
    .values({ id: propertyId, code: propertyCode, name: propertyName, city: propertyCity, sortOrder: 0 })
    .onConflictDoNothing();

  // 3. admin user — never overwrite an existing account's password
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email!)).limit(1);
  let userId: number;
  if (existing) {
    userId = existing.id;
    console.log(`  user ${email} already exists — leaving it untouched.`);
  } else {
    const passwordHash = await bcrypt.hash(password!, 10);
    const [created] = await db
      .insert(users)
      .values({ email: email!, passwordHash, name, status: 'active' })
      .returning({ id: users.id });
    userId = created.id;
    console.log(`  created user ${email}`);
  }

  // 4. grant admin on the property (only if not already granted)
  const [granted] = await db
    .select({ id: assignments.id })
    .from(assignments)
    .where(
      and(
        eq(assignments.userId, userId),
        eq(assignments.hotelId, propertyId),
        eq(assignments.roleId, 'admin')
      )
    )
    .limit(1);
  if (!granted) {
    await db.insert(assignments).values({ userId, hotelId: propertyId, roleId: 'admin' });
    console.log(`  granted admin on property "${propertyId}"`);
  } else {
    console.log(`  admin already granted on "${propertyId}".`);
  }

  console.log(`✓ Done. Sign in as ${email}, then add properties/floors/devices in the UI.`);
}

seedAdmin()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Admin seed failed:', err);
    process.exit(1);
  });
