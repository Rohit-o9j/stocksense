/**
 * Seed CLI. All the data and logic live in ./demo-data so the admin dashboard
 * runs exactly the same code.
 *
 *   bun run db:seed              reference data only — categories, warehouses, locations, demo logins
 *   bun run db:seed -- --demo    reference data plus the demo inventory
 *   bun run db:seed -- --reset   clear inventory first (never touches user accounts)
 */
import { db, pool } from './index';
import {
  DEMO_USERS,
  DEV_PASSWORD,
  checkIntegrity,
  countRows,
  resetInventory,
  seedBaseline,
  seedDemo,
} from './demo-data';

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const withDemo = args.has('--demo');
  const withReset = args.has('--reset');

  await db.transaction(async (tx) => {
    if (withReset) {
      console.log('Clearing inventory (user accounts are left alone)...');
      await resetInventory(tx);
    }

    const baseline = await seedBaseline(tx);
    console.log(
      `Reference data: +${baseline.categories} categories, +${baseline.warehouses} warehouses, ` +
        `+${baseline.locations} locations, +${baseline.users} demo logins.`,
    );

    if (!withDemo) return;

    const demo = await seedDemo(tx);
    console.log(
      `Demo inventory: ${demo.products} products, ${demo.completedDocuments} completed and ` +
        `${demo.pendingDocuments} in-flight documents, ${demo.moves} ledger entries.`,
    );
  });

  const counts = await countRows(db);
  const integrity = await checkIntegrity(db);

  console.log('');
  console.log(
    Object.entries(counts)
      .map(([table, n]) => `${table}=${n}`)
      .join(' '),
  );
  console.log(
    integrity.issues.length === 0
      ? `Integrity OK — ledger matches on hand for all ${integrity.checked} products.`
      : `Integrity FAILED for ${integrity.issues.length} of ${integrity.checked} products.`,
  );
  for (const issue of integrity.issues) {
    console.log(`  ${issue.sku}: quants=${issue.quants} ledger=${issue.ledger}`);
  }

  console.log('');
  console.log('Demo logins (development only):');
  for (const user of DEMO_USERS) console.log(`  ${user.email}  /  ${DEV_PASSWORD}   (${user.role})`);

  await pool.end();
}

main().catch(async (error: unknown) => {
  console.error(error);
  await pool.end();
  process.exitCode = 1;
});
