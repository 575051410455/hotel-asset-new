import { Hono } from 'hono';
import { and, eq, or, ilike, asc } from 'drizzle-orm';
import { zValidator } from '@hono/zod-validator';
import { db } from '../db';
import { devices } from '../db/schema';
import {
  createDeviceSchema,
  updateDeviceSchema,
  deviceQuerySchema,
  batchDeleteSchema,
} from '../shared/types';
import { authMiddleware, type AuthVariables } from '../middleware/auth';
import { buildUserContext, canAccess } from '../lib/session';

export const deviceRoutes = new Hono<{ Variables: AuthVariables }>();

// GET /api/devices?hotelId=&floorId=&department=&status=&search=
// The device inventory that powers the Dashboard table and map pin details.
deviceRoutes.get('/', authMiddleware, zValidator('query', deviceQuerySchema), async (c) => {
  const userId = Number(c.get('userId'));
  const q = c.req.valid('query');

  const ctx = await buildUserContext(userId);
  if (!canAccess(ctx, q.hotelId, 'devices', 'read')) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const filters = [eq(devices.hotelId, q.hotelId)];
  if (q.floorId) filters.push(eq(devices.floorId, q.floorId));
  if (q.department) filters.push(eq(devices.department, q.department));
  if (q.status) filters.push(eq(devices.status, q.status));
  if (q.search) {
    const s = `%${q.search}%`;
    const match = or(
      ilike(devices.computerName, s),
      ilike(devices.name, s),
      ilike(devices.department, s),
      ilike(devices.ip, s),
      ilike(devices.model, s)
    );
    if (match) filters.push(match);
  }

  const rows = await db
    .select()
    .from(devices)
    .where(and(...filters))
    .orderBy(asc(devices.computerName));

  return c.json(rows);
});

// GET /api/devices/:id
deviceRoutes.get('/:id', authMiddleware, async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ error: 'Invalid id' }, 400);

  const [device] = await db.select().from(devices).where(eq(devices.id, id)).limit(1);
  if (!device) return c.json({ error: 'Device not found' }, 404);

  const ctx = await buildUserContext(Number(c.get('userId')));
  if (!canAccess(ctx, device.hotelId, 'devices', 'read')) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  return c.json(device);
});

// POST /api/devices — create a device (requires CRUD on devices for the hotel)
deviceRoutes.post('/', authMiddleware, zValidator('json', createDeviceSchema), async (c) => {
  const userId = Number(c.get('userId'));
  const body = c.req.valid('json');

  const ctx = await buildUserContext(userId);
  if (!canAccess(ctx, body.hotelId, 'devices', 'crud')) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const [existing] = await db
    .select({ id: devices.id })
    .from(devices)
    .where(and(eq(devices.hotelId, body.hotelId), eq(devices.computerName, body.computerName)))
    .limit(1);
  if (existing) return c.json({ error: 'A device with that name already exists' }, 409);

  const [created] = await db.insert(devices).values(body).returning();
  return c.json(created, 201);
});

// PATCH /api/devices/:id — update editable fields
deviceRoutes.patch('/:id', authMiddleware, zValidator('json', updateDeviceSchema), async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ error: 'Invalid id' }, 400);
  const patch = c.req.valid('json');

  const [device] = await db.select().from(devices).where(eq(devices.id, id)).limit(1);
  if (!device) return c.json({ error: 'Device not found' }, 404);

  const ctx = await buildUserContext(Number(c.get('userId')));
  if (!canAccess(ctx, device.hotelId, 'devices', 'crud')) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const [updated] = await db
    .update(devices)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(devices.id, id))
    .returning();
  return c.json(updated);
});

// DELETE /api/devices/:id
deviceRoutes.delete('/:id', authMiddleware, async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ error: 'Invalid id' }, 400);

  const [device] = await db.select().from(devices).where(eq(devices.id, id)).limit(1);
  if (!device) return c.json({ error: 'Device not found' }, 404);

  const ctx = await buildUserContext(Number(c.get('userId')));
  if (!canAccess(ctx, device.hotelId, 'devices', 'crud')) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  await db.delete(devices).where(eq(devices.id, id));
  return c.json({ ok: true });
});

// POST /api/devices/batch-delete
deviceRoutes.post('/batch-delete', authMiddleware, zValidator('json', batchDeleteSchema), async (c) => {
  const userId = Number(c.get('userId'));
  const { ids } = c.req.valid('json');

  const rows = await db.select().from(devices).where(
    // limit to the requested ids
    or(...ids.map((i) => eq(devices.id, i)))!
  );

  const ctx = await buildUserContext(userId);
  const deletable: number[] = [];
  for (const d of rows) {
    if (canAccess(ctx, d.hotelId, 'devices', 'crud')) deletable.push(d.id);
  }
  if (deletable.length === 0) return c.json({ error: 'Forbidden' }, 403);

  await db.delete(devices).where(or(...deletable.map((i) => eq(devices.id, i)))!);
  return c.json({ ok: true, deleted: deletable.length });
});
