import {
  pgTable,
  serial,
  varchar,
  integer,
  text,
  boolean,
  real,
  timestamp,
  jsonb,
  pgEnum,
  primaryKey,
  foreignKey,
  unique,
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
export type RolePerms = {
  devices: PermLevel;
  floors: PermLevel;
  cctv: PermLevel;
  access: PermLevel;
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
  perms: jsonb('perms').$type<RolePerms>().notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: varchar('email', { length: 255 }).unique().notNull(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  name: varchar('name', { length: 120 }).notNull(),
  phone: varchar('phone', { length: 32 }),
  title: varchar('title', { length: 120 }),
  department: varchar('department', { length: 80 }),
  status: varchar('status', { length: 16 }).notNull().default('active'), // active | suspended
  lastLogin: timestamp('last_login'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const groups = pgTable('groups', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 120 }).notNull(),
  roleId: varchar('role_id', { length: 32 })
    .references(() => roles.id)
    .notNull(),
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

// ── Inferred row types ───────────────────────────────────────────────────────
export type Hotel = typeof hotels.$inferSelect;
export type Role = typeof roles.$inferSelect;
export type UserRow = typeof users.$inferSelect;
export type Group = typeof groups.$inferSelect;
export type Floor = typeof floors.$inferSelect;
export type Device = typeof devices.$inferSelect;
export type NewDevice = typeof devices.$inferInsert;
