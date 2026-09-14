// Account lifecycle guards shared by the User Management routes.
//
// Lifecycle changes (suspend, archive) run inside one transaction that first
// takes a transaction-scoped advisory lock, so two administrators acting at
// once are applied one after the other and the "someone must remain" check
// below always sees the other's result.
import { and, eq, ne, sql } from 'drizzle-orm';
import type { db } from '../db';
import { users } from '../db/schema';

type Queryable = Pick<typeof db, 'select' | 'execute'>;

const LIFECYCLE_LOCK = 72_410_002;

/** A refused lifecycle change, carrying the HTTP status to answer with. */
export class LifecycleRefusal extends Error {
  readonly status: 400 | 409;

  constructor(message: string, status: 400 | 409) {
    super(message);
    this.status = status;
  }
}

export async function lockAccountLifecycle(tx: Queryable) {
  await tx.execute(sql`select pg_advisory_xact_lock(${LIFECYCLE_LOCK})`);
}

/**
 * Refuses to take the last Active Platform Administrator out of Active status,
 * which would leave nobody able to manage the installation. Call inside the
 * locked transaction, before applying the change.
 */
export async function assertPlatformAdminRemains(tx: Queryable, targetUserId: number) {
  const [target] = await tx
    .select({ platformAdmin: users.platformAdmin, status: users.status })
    .from(users)
    .where(eq(users.id, targetUserId))
    .limit(1);
  if (!target || !target.platformAdmin || target.status !== 'active') return;

  const [{ others }] = await tx
    .select({ others: sql<number>`count(*)::int` })
    .from(users)
    .where(and(eq(users.platformAdmin, true), eq(users.status, 'active'), ne(users.id, targetUserId)));
  if (others === 0) {
    throw new LifecycleRefusal(
      'This is the last active Platform Administrator. Make another account a Platform Administrator first.',
      409
    );
  }
}
