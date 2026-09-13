import { sql } from 'drizzle-orm';
import {
  pgTable,
  serial,
  bigserial,
  bigint,
  varchar,
  integer,
  text,
  boolean,
  real,
  timestamp,
  jsonb,
  uuid,
  pgEnum,
  primaryKey,
  foreignKey,
  unique,
  index,
  check,
} from 'drizzle-orm/pg-core';

// ── Enums ────────────────────────────────────────────────────────────────────
// Workstation/AP: active | paused | nodata. Camera: rec | active | offline.
export const deviceStatusEnum = pgEnum('device_status', [
  'active',
  'paused',
  'nodata',
  'rec',
  'offline',
]);

// Permission level per resource, stored on a role.
export type PermLevel = 'none' | 'read' | 'crud';
// Canonical permissions a role grants. `userManagement` was persisted as
// `access` before the rename — read roles through normalizeRolePerms
// (src/lib/permissions.ts), never straight from the column.
export type RolePerms = {
  devices: PermLevel;
  floors: PermLevel;
  cctv: PermLevel;
  userManagement: PermLevel;
};
// What roles.perms may hold while the rename overlaps: either key, or both.
export type StoredRolePerms = {
  devices?: PermLevel;
  floors?: PermLevel;
  cctv?: PermLevel;
  userManagement?: PermLevel;
  access?: PermLevel;
};

// ── Tables ───────────────────────────────────────────────────────────────────

// Each hotel is a separate "property" / dashboard scope.
export const hotels = pgTable('hotels', {
  id: varchar('id', { length: 16 }).primaryKey(), // 'rh2'
  code: varchar('code', { length: 8 }).notNull(), // 'RH2'
  name: varchar('name', { length: 120 }).notNull(),
  city: varchar('city', { length: 80 }).notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const roles = pgTable('roles', {
  id: varchar('id', { length: 32 }).primaryKey(), // 'admin' | 'manager' | 'viewer' | custom
  name: varchar('name', { length: 80 }).notNull(),
  description: text('description').notNull().default(''),
  builtin: boolean('builtin').notNull().default(false),
  perms: jsonb('perms').$type<StoredRolePerms>().notNull(),
  // Optimistic concurrency: a stale editor's write is refused, not applied.
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').defaultNow(),
});

// Account lifecycle: Active, Suspended (reversible hold) or Archived (a former
// account kept for audit history — replaces hard deletion).
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: varchar('email', { length: 255 }).unique().notNull(),
  // Nullable: Google-provisioned accounts have no local password.
  passwordHash: varchar('password_hash', { length: 255 }),
  // Google subject id (stable per Google account). Set when the user signs in
  // with Google; unique so two local users can't claim the same Google identity.
  googleSub: varchar('google_sub', { length: 255 }).unique(),
  avatar: varchar('avatar', { length: 512 }), // profile picture URL (from Google)
  name: varchar('name', { length: 120 }).notNull(),
  phone: varchar('phone', { length: 32 }),
  title: varchar('title', { length: 120 }),
  department: varchar('department', { length: 80 }),
  status: varchar('status', { length: 16 }).notNull().default('active'), // active | suspended | archived
  // Platform-wide User Management authority, separate from per-hotel roles.
  platformAdmin: boolean('platform_admin').notNull().default(false),
  // The only accounts allowed a local password; they authenticate with TOTP too.
  breakGlass: boolean('break_glass').notNull().default(false),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  version: integer('version').notNull().default(1),
  lastLogin: timestamp('last_login'),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => [
  check('users_status_check', sql`${t.status} in ('active', 'suspended', 'archived')`),
]);

export const groups = pgTable('groups', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 120 }).notNull(),
  roleId: varchar('role_id', { length: 32 })
    .references(() => roles.id)
    .notNull(),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').defaultNow(),
});

// A group grants its role on this set of properties.
export const groupHotels = pgTable(
  'group_hotels',
  {
    groupId: integer('group_id')
      .references(() => groups.id, { onDelete: 'cascade' })
      .notNull(),
    hotelId: varchar('hotel_id', { length: 16 })
      .references(() => hotels.id, { onDelete: 'cascade' })
      .notNull(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.hotelId] })]
);

export const groupMembers = pgTable(
  'group_members',
  {
    groupId: integer('group_id')
      .references(() => groups.id, { onDelete: 'cascade' })
      .notNull(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.userId] })]
);

// Direct (non-group) per-property role grant on a user.
export const assignments = pgTable('assignments', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  hotelId: varchar('hotel_id', { length: 16 })
    .references(() => hotels.id, { onDelete: 'cascade' })
    .notNull(),
  roleId: varchar('role_id', { length: 32 })
    .references(() => roles.id)
    .notNull(),
});

// A floor is identified by its slug WITHIN a property: PK = (hotelId, id).
// The same slug ('office') can therefore exist under several hotels.
export const floors = pgTable(
  'floors',
  {
    id: varchar('id', { length: 32 }).notNull(), // slug, unique within the property
    hotelId: varchar('hotel_id', { length: 16 })
      .references(() => hotels.id, { onDelete: 'cascade' })
      .notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    short: varchar('short', { length: 60 }).notNull(),
    route: varchar('route', { length: 60 }).notNull().default(''), // e.g. '/office'
    kind: varchar('kind', { length: 16 }).notNull().default('workstation'), // workstation | cctv
    image: varchar('image', { length: 255 }), // floor-plan image URL (nullable until uploaded)
    aspect: real('aspect').notNull().default(0.75), // image height / width
    departments: jsonb('departments').$type<string[]>().notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    deletedAt: timestamp('deleted_at'), // soft delete
  },
  (t) => [primaryKey({ columns: [t.hotelId, t.id] })]
);

// A device is both an inventory row and a map pin (x/y placement on its floor).
// Asset id (computer_name) is unique WITHIN a property; floor link is the
// composite (hotelId, floorId) → floors(hotelId, id).
export const devices = pgTable(
  'devices',
  {
    id: serial('id').primaryKey(),
    hotelId: varchar('hotel_id', { length: 16 })
      .references(() => hotels.id, { onDelete: 'cascade' })
      .notNull(),
    floorId: varchar('floor_id', { length: 32 }),
    computerName: varchar('computer_name', { length: 80 }).notNull(), // asset id, e.g. ACC-AP-01
    name: varchar('name', { length: 120 }).notNull().default(''), // employee / display name
    department: varchar('department', { length: 80 }),
    type: varchar('type', { length: 40 }).notNull().default('Desktop'),
    status: deviceStatusEnum('status').notNull().default('active'),
    // map placement
    x: real('x'),
    y: real('y'),
    dir: real('dir'), // camera view direction in degrees (0 = east)
    isAp: boolean('is_ap').notNull().default(false),
    // workstation specs
    os: varchar('os', { length: 80 }),
    cpu: varchar('cpu', { length: 120 }),
    ram: varchar('ram', { length: 80 }),
    motherboard: varchar('motherboard', { length: 120 }),
    graphics: varchar('graphics', { length: 120 }),
    storage: varchar('storage', { length: 120 }),
    monitor: varchar('monitor', { length: 120 }),
    // camera / access-point fields
    model: varchar('model', { length: 120 }),
    ip: varchar('ip', { length: 64 }),
    resolution: varchar('resolution', { length: 80 }),
    lens: varchar('lens', { length: 80 }),
    retention: varchar('retention', { length: 40 }),
    nvr: varchar('nvr', { length: 60 }),
    codec: varchar('codec', { length: 40 }), // camera: H.264 / H.265
    poe: varchar('poe', { length: 40 }), // camera: PoE class / power
    ssid: varchar('ssid', { length: 120 }),
    band: varchar('band', { length: 40 }),
    channel: varchar('channel', { length: 40 }),
    clients: varchar('clients', { length: 16 }),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.hotelId, t.floorId],
      foreignColumns: [floors.hotelId, floors.id],
      name: 'devices_floor_fk',
    }),
    unique('devices_hotel_computer_uq').on(t.hotelId, t.computerName),
  ]
);

// ── Security foundation ──────────────────────────────────────────────────────
// Storage for docs/specs/security-hardening-and-user-management.md. Nothing reads
// these tables yet; the session, MFA and throttling behaviour lands in later
// phases on top of them.

// An opaque, revocable server-side session. The browser holds the random session
// identifier in an HttpOnly cookie; only its SHA-256 digest is stored here, so a
// database read cannot be replayed as a login. `id` is the internal reference
// used by audit events and the session list — never the credential.
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    authMethod: varchar('auth_method', { length: 16 }).notNull(), // google | break_glass | password
    csrfTokenHash: varchar('csrf_token_hash', { length: 64 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    // When the user last proved who they are — privileged actions need this recent.
    authenticatedAt: timestamp('authenticated_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(), // absolute (12h) limit
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: varchar('revoked_reason', { length: 32 }),
    clientIp: varchar('client_ip', { length: 64 }),
    userAgent: varchar('user_agent', { length: 512 }),
  },
  (t) => [
    index('sessions_user_idx').on(t.userId),
    check('sessions_auth_method_check', sql`${t.authMethod} in ('google', 'break_glass', 'password')`),
  ]
);

// Append-only Security audit events, retained 180 days. A trigger in the
// migration refuses UPDATE, TRUNCATE and ordinary DELETE; only the retention
// purge may delete. Actor/target columns carry no foreign keys on purpose: an
// event must outlive every row it mentions. Never store secrets in `metadata`.
export const auditEvents = pgTable(
  'audit_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    eventType: varchar('event_type', { length: 64 }).notNull(),
    outcome: varchar('outcome', { length: 16 }).notNull(),
    actorUserId: integer('actor_user_id'),
    actorSessionId: uuid('actor_session_id'),
    targetType: varchar('target_type', { length: 32 }),
    targetId: varchar('target_id', { length: 64 }),
    hotelId: varchar('hotel_id', { length: 16 }),
    clientIp: varchar('client_ip', { length: 64 }),
    userAgent: varchar('user_agent', { length: 512 }),
    correlationId: varchar('correlation_id', { length: 64 }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  },
  (t) => [
    index('audit_events_occurred_idx').on(t.occurredAt),
    index('audit_events_actor_idx').on(t.actorUserId),
    check('audit_events_outcome_check', sql`${t.outcome} in ('success', 'failure', 'denied', 'throttled')`),
  ]
);

// Shared, persistent throttling state (not process-local), one row per key and
// fixed window — e.g. login attempts per normalised account and per client address.
export const rateLimitBuckets = pgTable(
  'rate_limit_buckets',
  {
    bucketKey: varchar('bucket_key', { length: 200 }).notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    hits: integer('hits').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.bucketKey, t.windowStart] }),
    index('rate_limit_buckets_window_idx').on(t.windowStart),
  ]
);

// TOTP for Break-glass administrators. The secret is stored only as ciphertext
// under a separately configured key; `lastAcceptedStep` rejects code replay.
export const breakGlassMfa = pgTable('break_glass_mfa', {
  userId: integer('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  totpSecretCiphertext: text('totp_secret_ciphertext').notNull(),
  totpEnrolledAt: timestamp('totp_enrolled_at', { withTimezone: true }).notNull().defaultNow(),
  lastAcceptedStep: bigint('last_accepted_step', { mode: 'number' }),
});

// One-way hashed, single-use recovery codes, shown once at enrolment.
export const recoveryCodes = pgTable(
  'recovery_codes',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    codeHash: varchar('code_hash', { length: 255 }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('recovery_codes_user_idx').on(t.userId)]
);

// ── Inferred row types ───────────────────────────────────────────────────────
export type Hotel = typeof hotels.$inferSelect;
export type Role = typeof roles.$inferSelect;
export type UserRow = typeof users.$inferSelect;
export type Group = typeof groups.$inferSelect;
export type Floor = typeof floors.$inferSelect;
export type Device = typeof devices.$inferSelect;
export type NewDevice = typeof devices.$inferInsert;
export type SessionRow = typeof sessions.$inferSelect;
export type AuditEvent = typeof auditEvents.$inferSelect;
