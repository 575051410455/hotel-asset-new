import { Hono, type Context } from 'hono';
import { and, eq, asc, isNull, sql, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { db } from '../db';
import { floors, devices } from '../db/schema';
import { createFloorSchema, updateFloorSchema, floorIdentSchema } from '../shared/types';
import { authMiddleware, type AuthVariables } from '../middleware/auth';
import { buildUserContext, canAccess } from '../lib/session';

export const floorRoutes = new Hono<{ Variables: AuthVariables }>();

const listQuery = z.object({
  hotelId: z.string().min(1).max(16),
  kind: z.enum(['workstation', 'cctv']).optional(),
});

// GET /api/floors?hotelId=&kind= — non-deleted floors for a property, each with
// its pins (devices that carry x/y placement). Powers the maps + data-driven nav.
floorRoutes.get('/', authMiddleware, zValidator('query', listQuery), async (c) => {
  const userId = Number(c.get('userId'));
  const { hotelId, kind } = c.req.valid('query');

  const ctx = await buildUserContext(userId);
  // Reading floor plans needs `floors` (or `cctv` for cctv-kind) read access.
  const allowedKinds = (['workstation', 'cctv'] as const).filter((candidate) =>
    (!kind || kind === candidate) &&
    canAccess(ctx, hotelId, candidate === 'cctv' ? 'cctv' : 'floors', 'read')
  );
  if (!allowedKinds.length) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const conds = [eq(floors.hotelId, hotelId), isNull(floors.deletedAt), inArray(floors.kind, allowedKinds)];

  const floorRows = await db
    .select()
    .from(floors)
    .where(and(...conds))
    .orderBy(asc(floors.sortOrder));

  const pinRows = floorRows.length ? await db.select().from(devices).where(and(
    eq(devices.hotelId, hotelId), inArray(devices.floorId, floorRows.map((floor) => floor.id))
  )) : [];

  const result = floorRows.map((f) => ({
    ...f,
    pins: pinRows.filter((p) => p.floorId === f.id && p.x !== null && p.y !== null),
    // Assigned to this floor but with no position on the plan yet — e.g. added
    // from the inventory list. Not pins, but the map offers to place them.
    unplaced: pinRows.filter((p) => p.floorId === f.id && (p.x === null || p.y === null)),
  }));

  return c.json(result);
});

// Floor management (create / rename / replace image / delete) is `floors:crud`.
async function requireFloorsCrud(c: Context<{ Variables: AuthVariables }>, hotelId: string) {
  const ctx = await buildUserContext(Number(c.get('userId')));
  return canAccess(ctx, hotelId, 'floors', 'crud');
}

// POST /api/floors — create a floor in a property (slug unique within it).
floorRoutes.post('/', authMiddleware, zValidator('json', createFloorSchema), async (c) => {
  const body = c.req.valid('json');
  if (!(await requireFloorsCrud(c, body.hotelId))) return c.json({ error: 'Forbidden' }, 403);

  // The PK (hotelId, slug) survives a soft-delete, so look up any existing row.
  const [existing] = await db
    .select()
    .from(floors)
    .where(and(eq(floors.hotelId, body.hotelId), eq(floors.id, body.id)))
    .limit(1);
  if (existing && existing.deletedAt === null) {
    return c.json({ error: `A floor "${body.id}" already exists for this property.` }, 409);
  }

  // Next sort order within the property.
  const [{ next } = { next: 0 }] = await db
    .select({ next: sql<number>`coalesce(max(${floors.sortOrder}), -1) + 1` })
    .from(floors)
    .where(eq(floors.hotelId, body.hotelId));

  const values = {
    name: body.name,
    short: body.short,
    route: body.route ?? `/${body.id}`,
    kind: body.kind,
    image: body.image ?? null,
    aspect: body.aspect ?? 0.75,
    departments: body.departments,
    sortOrder: next,
    deletedAt: null,
  };

  if (existing) {
    // Revive a previously soft-deleted floor so the slug can be reused.
    const [revived] = await db
      .update(floors)
      .set(values)
      .where(and(eq(floors.hotelId, body.hotelId), eq(floors.id, body.id)))
      .returning();
    return c.json({ ...revived, pins: [] }, 201);
  }

  const [created] = await db
    .insert(floors)
    .values({ id: body.id, hotelId: body.hotelId, ...values })
    .returning();
  return c.json({ ...created, pins: [] }, 201);
});

// PATCH /api/floors/:id?hotelId= — rename, replace plan image, edit departments.
floorRoutes.patch(
  '/:id',
  authMiddleware,
  zValidator('query', floorIdentSchema),
  zValidator('json', updateFloorSchema),
  async (c) => {
    const id = c.req.param('id');
    const { hotelId } = c.req.valid('query');
    if (!(await requireFloorsCrud(c, hotelId))) return c.json({ error: 'Forbidden' }, 403);

    const patch = c.req.valid('json');
    // Unknown keys (e.g. `kind`, which is permanent) are stripped by the schema,
    // so a body carrying only those leaves nothing to write.
    if (Object.keys(patch).length === 0) {
      return c.json({ error: 'Nothing to update. A floor\'s kind cannot be changed — delete it and create it again.' }, 400);
    }
    const [updated] = await db
      .update(floors)
      .set(patch)
      .where(and(eq(floors.hotelId, hotelId), eq(floors.id, id), isNull(floors.deletedAt)))
      .returning();
    if (!updated) return c.json({ error: 'Floor not found' }, 404);
    return c.json(updated);
  }
);

// DELETE /api/floors/:id?hotelId= — soft-delete + detach its pins (devices stay
// in the inventory but lose their map placement).
floorRoutes.delete('/:id', authMiddleware, zValidator('query', floorIdentSchema), async (c) => {
  const id = c.req.param('id');
  const { hotelId } = c.req.valid('query');
  if (!(await requireFloorsCrud(c, hotelId))) return c.json({ error: 'Forbidden' }, 403);

  const [floor] = await db
    .select({ id: floors.id })
    .from(floors)
    .where(and(eq(floors.hotelId, hotelId), eq(floors.id, id), isNull(floors.deletedAt)))
    .limit(1);
  if (!floor) return c.json({ error: 'Floor not found' }, 404);

  // Detach pins: clear the floor link + placement on the property's devices.
  await db
    .update(devices)
    .set({ floorId: null, x: null, y: null })
    .where(and(eq(devices.hotelId, hotelId), eq(devices.floorId, id)));

  await db
    .update(floors)
    .set({ deletedAt: new Date() })
    .where(and(eq(floors.hotelId, hotelId), eq(floors.id, id)));

  return c.json({ ok: true });
});
