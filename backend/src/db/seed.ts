// ─────────────────────────────────────────────────────────────────────────────
// Seed the opsmonitor database to reproduce the prototype's demo data exactly.
//
// HOTELS, FLOORS and buildInventory() are imported straight from the prototype's
// config modules (they are pure, deterministic exports) so the device specs and
// map pins match the design 1:1. The role/group/user defaults are not exported
// by auth-config.js, so they are ported here verbatim.
//
// All floor/device data is seeded under hotel "rh2" — the property every demo
// account can access — which also satisfies the global-unique computer_name
// constraint (each asset id appears once).
//
// Run with: bun run db:seed
import bcrypt from 'bcryptjs';
import { db } from './index';
import {
  hotels,
  roles,
  users,
  groups,
  groupHotels,
  groupMembers,
  assignments,
  floors,
  devices,
  type RolePerms,
  type NewDevice,
} from './schema';

// Pure data/logic imported from the design handoff (the source of truth).
// @ts-expect-error — JS module from the prototype bundle, no types.
import { HOTELS } from '../../../_extracted/ops-monitoring-dashboard-prototype/project/auth-config.js';
import {
  FLOORS,
  buildInventory,
  // @ts-expect-error — JS module from the prototype bundle, no types.
} from '../../../_extracted/ops-monitoring-dashboard-prototype/project/floor-config.js';

const HOME_HOTEL = 'rh2';

// ── Ported role/group/user defaults (auth-config.js, not exported) ────────────
const DEFAULT_ROLES = [
  { id: 'admin', name: 'Administrator', builtin: true, description: 'Full control: devices, floor plans, cameras and access management.', perms: { devices: 'crud', floors: 'crud', cctv: 'crud', access: 'crud' } as RolePerms },
  { id: 'manager', name: 'IT Manager', builtin: true, description: 'Manage devices and floor plans; view cameras and access settings.', perms: { devices: 'crud', floors: 'crud', cctv: 'read', access: 'read' } as RolePerms },
  { id: 'viewer', name: 'Viewer', builtin: true, description: 'Read-only access to dashboards and floor maps.', perms: { devices: 'read', floors: 'read', cctv: 'read', access: 'none' } as RolePerms },
];

const DEFAULT_GROUPS = [
  { protoId: 'g-itops', name: 'IT Operations', roleId: 'admin', hotels: ['rh2', 'rh3', 'rbr'], members: ['u-chai', 'u-ohm'] },
  { protoId: 'g-eng', name: 'Engineering', roleId: 'manager', hotels: ['rh2', 'rh3'], members: ['u-smart'] },
  { protoId: 'g-fo', name: 'Front Office', roleId: 'viewer', hotels: ['rh2'], members: ['u-gift', 'u-pang'] },
];

const DEFAULT_USERS = [
  { protoId: 'u-chai', name: 'Chai W.', email: 'chai@richmond.local', phone: '081-234-5601', title: 'IT Supervisor', department: 'IT', status: 'active', password: 'admin123', assignments: [] as Array<{ hotelId: string; roleId: string }>, lastLogin: '2026-06-12T08:42:00' },
  { protoId: 'u-ohm', name: 'Ohm P.', email: 'ohm@richmond.local', phone: '081-234-5602', title: 'IT Support', department: 'IT', status: 'active', password: 'admin123', assignments: [], lastLogin: '2026-06-11T17:05:00' },
  { protoId: 'u-smart', name: 'Smart K.', email: 'smart@richmond.local', phone: '081-234-5603', title: 'Systems Engineer', department: 'IT', status: 'active', password: 'manager123', assignments: [], lastLogin: '2026-06-12T07:58:00' },
  { protoId: 'u-gift', name: 'Gift N.', email: 'gift@richmond.local', phone: '081-234-5604', title: 'Reservations Agent', department: 'RSVN', status: 'active', password: 'user123', assignments: [], lastLogin: '2026-06-10T09:21:00' },
  { protoId: 'u-pang', name: 'Pang C.', email: 'pang@richmond.local', phone: '081-234-5605', title: 'Reservations Agent', department: 'RSVN', status: 'active', password: 'user123', assignments: [], lastLogin: '2026-06-08T14:33:00' },
  { protoId: 'u-mali', name: 'Mali S.', email: 'mali@richmond.local', phone: '081-234-5606', title: 'Accountant (AR)', department: 'Account', status: 'active', password: 'user123', assignments: [{ hotelId: 'rh2', roleId: 'viewer' }], lastLogin: '2026-06-09T10:12:00' },
  { protoId: 'u-best', name: 'Best P.', email: 'best@richmond.local', phone: '081-234-5607', title: 'Graphic Designer', department: 'GRAPHIC', status: 'suspended', password: 'user123', assignments: [{ hotelId: 'rh2', roleId: 'viewer' }], lastLogin: '2026-05-28T16:47:00' },
];

// Image basenames the frontend serves from /floors/.
const FLOOR_IMAGE: Record<string, string> = {
  account: '/floors/floor-account.jpg',
  office: '/floors/floor-office.jpg',
  l4: '/floors/floor-l4.png',
};

// Prototype inventory uses '—' for not-applicable spec fields; store null.
const clean = (v: unknown): string | null => {
  if (v === undefined || v === null) return null;
  const s = String(v);
  return s === '—' || s === '' ? null : s;
};

async function seed() {
  console.log('Seeding opsmonitor…');

  // Clear in FK-safe order.
  await db.delete(devices);
  await db.delete(floors);
  await db.delete(assignments);
  await db.delete(groupMembers);
  await db.delete(groupHotels);
  await db.delete(groups);
  await db.delete(users);
  await db.delete(roles);
  await db.delete(hotels);

  // Hotels
  await db.insert(hotels).values(
    HOTELS.map((h: any, i: number) => ({
      id: h.id,
      code: h.code,
      name: h.name,
      city: h.city,
      sortOrder: i,
    }))
  );
  console.log(`  hotels: ${HOTELS.length}`);

  // Roles
  await db.insert(roles).values(DEFAULT_ROLES);
  console.log(`  roles: ${DEFAULT_ROLES.length}`);

  // Users (bcrypt-hashed). Map prototype id → db serial id.
  const userIdByProto = new Map<string, number>();
  for (const u of DEFAULT_USERS) {
    const passwordHash = await bcrypt.hash(u.password, 10);
    const [row] = await db
      .insert(users)
      .values({
        email: u.email,
        passwordHash,
        name: u.name,
        phone: u.phone,
        title: u.title,
        department: u.department,
        status: u.status,
        lastLogin: new Date(u.lastLogin),
      })
      .returning({ id: users.id });
    userIdByProto.set(u.protoId, row.id);
  }
  console.log(`  users: ${DEFAULT_USERS.length}`);

  // Groups + memberships + granted hotels
  for (const g of DEFAULT_GROUPS) {
    const [row] = await db
      .insert(groups)
      .values({ name: g.name, roleId: g.roleId })
      .returning({ id: groups.id });
    const groupId = row.id;
    if (g.hotels.length) {
      await db.insert(groupHotels).values(g.hotels.map((hotelId) => ({ groupId, hotelId })));
    }
    const memberIds = g.members
      .map((m) => userIdByProto.get(m))
      .filter((x): x is number => x !== undefined);
    if (memberIds.length) {
      await db.insert(groupMembers).values(memberIds.map((userId) => ({ groupId, userId })));
    }
  }
  console.log(`  groups: ${DEFAULT_GROUPS.length}`);

  // Direct assignments
  const assignmentRows = DEFAULT_USERS.flatMap((u) =>
    u.assignments.map((a) => ({
      userId: userIdByProto.get(u.protoId)!,
      hotelId: a.hotelId,
      roleId: a.roleId,
    }))
  );
  if (assignmentRows.length) {
    await db.insert(assignments).values(assignmentRows);
  }
  console.log(`  assignments: ${assignmentRows.length}`);

  // Floors (under the home hotel)
  const floorRows = Object.values(FLOORS).map((f: any, i: number) => ({
    id: f.id,
    hotelId: HOME_HOTEL,
    name: f.name,
    short: f.short,
    route: f.route ?? '/' + f.id,
    kind: f.kind === 'cctv' ? 'cctv' : 'workstation',
    image: FLOOR_IMAGE[f.id] ?? f.image,
    aspect: f.aspect,
    departments: f.departments,
    sortOrder: i,
  }));
  await db.insert(floors).values(floorRows);
  console.log(`  floors: ${floorRows.length}`);

  // Devices — from the prototype's deterministic inventory, joined with pin coords.
  const pinByName = new Map<string, any>();
  for (const f of Object.values(FLOORS) as any[]) {
    for (const pin of f.pins) pinByName.set(pin.id, pin);
  }

  const inventory: any[] = buildInventory();
  const deviceRows: NewDevice[] = inventory.map((r) => {
    const pin = pinByName.get(r.ComputerName) ?? {};
    return {
      hotelId: HOME_HOTEL,
      floorId: r.Floor,
      computerName: r.ComputerName,
      name: r.Name ?? '',
      department: r.Department ?? null,
      type: r.Type ?? 'Desktop',
      status: r.Status,
      x: pin.x ?? null,
      y: pin.y ?? null,
      dir: pin.dir ?? null,
      isAp: pin.ap === true,
      os: clean(r.OS),
      cpu: clean(r.CPU),
      ram: clean(r.RAM),
      motherboard: clean(r.Motherboard),
      graphics: clean(r.Graphics),
      storage: clean(r.Storage),
      monitor: clean(r.Monitor),
      model: clean(r.Model),
      ip: clean(r.IP),
      resolution: clean(r.Resolution),
      lens: clean(r.Lens),
      retention: clean(r.Retention),
      nvr: clean(r.NVR),
      ssid: clean(r.SSID),
      band: clean(r.Band),
      channel: clean(r.Channel),
      clients: clean(r.Clients),
    };
  });
  await db.insert(devices).values(deviceRows);
  console.log(`  devices: ${deviceRows.length}`);

  console.log('Done. Demo logins: chai@richmond.local / admin123 (admin),');
  console.log('  smart@richmond.local / manager123 (manager), gift@richmond.local / user123 (viewer).');
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
