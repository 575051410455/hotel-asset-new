import { z } from 'zod';

// ── Enums ────────────────────────────────────────────────────────────────────
// Workstation/AP: active | paused | nodata. Camera: rec | active | offline.
export const deviceStatusEnum = z.enum(['active', 'paused', 'nodata', 'rec', 'offline']);
export type DeviceStatusT = z.infer<typeof deviceStatusEnum>;

export const permLevelEnum = z.enum(['none', 'read', 'crud']);

// ── Auth ─────────────────────────────────────────────────────────────────────
export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6, 'New password must be at least 6 characters'),
});

export const updateProfileSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  phone: z.string().max(32).optional(),
  title: z.string().max(120).optional(),
});

// ── Devices ──────────────────────────────────────────────────────────────────
// Editable device fields (used by Dashboard + Floor map CRUD). Hardware spec
// fields are free-form strings to mirror the prototype's flexible inventory rows.
const deviceWritableFields = {
  computerName: z.string().min(1).max(80),
  name: z.string().max(120).default(''),
  department: z.string().max(80).nullish(),
  type: z.string().min(1).max(40).default('Desktop'),
  status: deviceStatusEnum.default('active'),
  floorId: z.string().max(32).nullish(),
  x: z.number().min(0).max(100).nullish(),
  y: z.number().min(0).max(100).nullish(),
  dir: z.number().nullish(),
  isAp: z.boolean().default(false),
  os: z.string().max(80).nullish(),
  cpu: z.string().max(120).nullish(),
  ram: z.string().max(80).nullish(),
  motherboard: z.string().max(120).nullish(),
  graphics: z.string().max(120).nullish(),
  storage: z.string().max(120).nullish(),
  monitor: z.string().max(120).nullish(),
  model: z.string().max(120).nullish(),
  ip: z.string().max(64).nullish(),
  resolution: z.string().max(80).nullish(),
  lens: z.string().max(80).nullish(),
  retention: z.string().max(40).nullish(),
  nvr: z.string().max(60).nullish(),
  codec: z.string().max(40).nullish(),
  poe: z.string().max(40).nullish(),
  ssid: z.string().max(120).nullish(),
  band: z.string().max(40).nullish(),
  channel: z.string().max(40).nullish(),
  clients: z.string().max(16).nullish(),
};

export const createDeviceSchema = z.object({
  hotelId: z.string().min(1).max(16),
  ...deviceWritableFields,
});

export const updateDeviceSchema = z.object(deviceWritableFields).partial();

export const deviceQuerySchema = z.object({
  hotelId: z.string().min(1).max(16),
  floorId: z.string().max(32).optional(),
  department: z.string().optional(),
  status: deviceStatusEnum.optional(),
  search: z.string().optional(),
});

export const batchDeleteSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1),
});

// ── Floors ───────────────────────────────────────────────────────────────────
const floorKindEnum = z.enum(['workstation', 'cctv']);
const slugRe = /^[a-z0-9][a-z0-9-]{0,30}$/;

export const createFloorSchema = z.object({
  hotelId: z.string().min(1).max(16),
  id: z.string().regex(slugRe, 'Slug must be lowercase letters, numbers or hyphens'),
  name: z.string().min(1).max(120),
  short: z.string().min(1).max(60),
  route: z.string().max(60).optional(),
  kind: floorKindEnum,
  image: z.string().max(255).nullish(),
  aspect: z.number().positive().max(10).optional(),
  departments: z.array(z.string().min(1).max(40)).default([]),
});

export const updateFloorSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  short: z.string().min(1).max(60).optional(),
  route: z.string().max(60).optional(),
  image: z.string().max(255).nullish(),
  aspect: z.number().positive().max(10).optional(),
  departments: z.array(z.string().min(1).max(40)).optional(),
  sortOrder: z.number().int().optional(),
});

export const floorIdentSchema = z.object({
  hotelId: z.string().min(1).max(16),
});

// ── Access control (users / roles / groups) ──────────────────────────────────
// A role's permissions as submitted. `userManagement` replaces the legacy
// `access` key; during the rename overlap either is accepted (a client on the
// previous release still sends `access`), but not two different values.
export const rolePermsSchema = z
  .object({
    devices: permLevelEnum,
    floors: permLevelEnum,
    cctv: permLevelEnum,
    userManagement: permLevelEnum.optional(),
    access: permLevelEnum.optional(),
  })
  .refine((p) => p.userManagement !== undefined || p.access !== undefined, {
    message: 'The User Management permission is required',
    path: ['userManagement'],
  })
  .refine((p) => p.userManagement === undefined || p.access === undefined || p.userManagement === p.access, {
    message: 'userManagement and the legacy access permission disagree',
    path: ['access'],
  });

// A prepared account signs in with Google: it is created without any password.
export const createUserSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email(),
  phone: z.string().max(32).nullish(),
  title: z.string().max(120).nullish(),
  department: z.string().max(80).nullish(),
});

export const updateUserSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(32).nullish(),
  title: z.string().max(120).nullish(),
  department: z.string().max(80).nullish(),
  status: z.enum(['active', 'suspended']).optional(),
});

export const resetPasswordSchema = z.object({
  newPassword: z.string().min(6).optional(),
});

export const assignmentsSchema = z.object({
  assignments: z.array(z.object({ hotelId: z.string().min(1), roleId: z.string().min(1) })),
});

export const membershipSchema = z.object({
  groupIds: z.array(z.number().int().positive()),
});

export const createRoleSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(400).default(''),
  perms: rolePermsSchema,
});

export const updateRoleSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(400).optional(),
  perms: rolePermsSchema.optional(),
});

export const createGroupSchema = z.object({
  name: z.string().min(1).max(120),
  roleId: z.string().min(1),
  hotelIds: z.array(z.string().min(1)).min(1, 'Pick at least one property'),
  memberIds: z.array(z.number().int().positive()).default([]),
});

export const updateGroupSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  roleId: z.string().min(1).optional(),
  hotelIds: z.array(z.string().min(1)).min(1).optional(),
  memberIds: z.array(z.number().int().positive()).optional(),
});

// ── Inferred types ───────────────────────────────────────────────────────────
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateDevice = z.infer<typeof createDeviceSchema>;
export type UpdateDevice = z.infer<typeof updateDeviceSchema>;
export type DeviceQuery = z.infer<typeof deviceQuerySchema>;
