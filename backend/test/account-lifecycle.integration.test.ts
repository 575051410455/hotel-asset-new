// The last-active-Platform-Administrator guard, against a disposable database
// so the test controls exactly who holds platform authority (the demo database
// has its own administrators that must not be touched).
import { afterAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../src/db/schema';
import { assertPlatformAdminRemains, lockAccountLifecycle, LifecycleRefusal } from '../src/lib/account-lifecycle';
import { disposableDbAvailable, migratedDatabase, dropDisposableDatabases } from './disposable-db';

afterAll(dropDisposableDatabases);

const suite = disposableDbAvailable ? describe : describe.skip;

suite('last active Platform Administrator (integration)', () => {
  test('one of two Active Platform Administrators may be removed; the last one may not', async () => {
    const url = await migratedDatabase();
    const client = postgres(url, { max: 2, onnotice: () => {} });
    const db = drizzle(client, { schema });
    const refusalFor = (userId: number) =>
      db
        .transaction(async (tx) => {
          await lockAccountLifecycle(tx);
          await assertPlatformAdminRemains(tx, userId);
        })
        .then(() => null, (err: unknown) => err);

    try {
      const insert = (email: string, platformAdmin: boolean) =>
        db.insert(schema.users).values({ email, name: email, platformAdmin }).returning().then((r) => r[0]);
      const first = await insert('first@x.invalid', true);
      const second = await insert('second@x.invalid', true);
      const ordinary = await insert('ordinary@x.invalid', false);

      expect(await refusalFor(first.id)).toBeNull(); // `second` would remain

      await db.update(schema.users).set({ status: 'suspended' }).where(eq(schema.users.id, second.id));
      const refused = await refusalFor(first.id);
      expect(refused).toBeInstanceOf(LifecycleRefusal);
      expect((refused as LifecycleRefusal).status).toBe(409);

      // Accounts without platform authority, or already inactive, are never blocked.
      expect(await refusalFor(ordinary.id)).toBeNull();
      expect(await refusalFor(second.id)).toBeNull();
    } finally {
      await client.end({ timeout: 1 });
    }
  });
});
