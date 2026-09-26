/**
 * Promotes an existing account to Admin.
 *
 *   bun run db:make-admin -- someone@example.com
 *
 * Needed because the Admin role was introduced after the first accounts were
 * created, so there is nobody who can grant it from inside the app yet.
 */
import { eq } from 'drizzle-orm';

import { db, pool } from './index';
import { users } from './schema';

async function main(): Promise<void> {
  const email = process.argv[2]?.trim().toLowerCase();

  if (!email) {
    console.error('Usage: bun run db:make-admin -- someone@example.com');
    process.exitCode = 1;
    return;
  }

  const [user] = await db
    .select({ id: users.id, name: users.name, role: users.role })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (!user) {
    console.error(`No account found for ${email}.`);
    const all = await db.select({ email: users.email, role: users.role }).from(users);
    if (all.length > 0) {
      console.error('Existing accounts:');
      for (const row of all) console.error(`  ${row.email} (${row.role})`);
    }
    process.exitCode = 1;
    return;
  }

  if (user.role === 'Admin') {
    console.log(`${email} is already an Admin.`);
    return;
  }

  await db.update(users).set({ role: 'Admin' }).where(eq(users.id, user.id));
  console.log(`${user.name} <${email}> promoted from ${user.role} to Admin.`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
