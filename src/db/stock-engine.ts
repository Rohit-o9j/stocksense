/**
 * The stock engine — the only code permitted to change on-hand quantities.
 *
 * Every quantity change goes through `applyMove`, which writes a `stock_moves`
 * ledger row and updates the affected `stock_quants` in the same statement
 * sequence. Callers must wrap it in `db.transaction()` so a partial failure
 * cannot leave the ledger disagreeing with on-hand quantities.
 *
 * Sign convention on the ledger: quantity is signed relative to the company.
 * Stock entering from a virtual location is positive, stock leaving to one is
 * negative, and a move between two internal locations is zero — the total did
 * not change, only where it sits.
 */
import { and, eq, sql } from 'drizzle-orm';

import type { Executor } from './index';
import {
  kindEnum,
  locationKindEnum,
  locations,
  operations,
  statusEnum,
  stockMoves,
  stockQuants,
} from './schema';

export type OperationKind = (typeof kindEnum.enumValues)[number];
export type LocationKind = (typeof locationKindEnum.enumValues)[number];
export type DocumentStatus = (typeof statusEnum.enumValues)[number];

/** Document reference prefixes, matching the references the UI already renders. */
const REFERENCE_PREFIX: Record<OperationKind, string> = {
  Receipt: 'WH/IN',
  Delivery: 'WH/OUT',
  'Internal Transfer': 'WH/INT',
  Adjustment: 'WH/ADJ',
};

export type LocationSummary = {
  id: string;
  kind: LocationKind;
  fullName: string;
};

async function requireLocation(tx: Executor, id: string): Promise<LocationSummary> {
  const [row] = await tx
    .select({ id: locations.id, kind: locations.kind, fullName: locations.fullName })
    .from(locations)
    .where(eq(locations.id, id))
    .limit(1);

  if (!row) throw new Error(`Location ${id} does not exist`);
  return row;
}

/** Current on-hand quantity for a product at one internal location. */
export async function getOnHand(
  tx: Executor,
  productId: string,
  locationId: string,
): Promise<number> {
  const [row] = await tx
    .select({ quantity: stockQuants.quantity })
    .from(stockQuants)
    .where(and(eq(stockQuants.productId, productId), eq(stockQuants.locationId, locationId)))
    .limit(1);

  return row?.quantity ?? 0;
}

/**
 * Add `delta` to the quant for a (product, location) pair, creating the row on
 * first use. The increment happens in SQL rather than read-modify-write, so
 * concurrent moves cannot lose an update.
 */
async function adjustQuant(
  tx: Executor,
  productId: string,
  locationId: string,
  delta: number,
): Promise<void> {
  await tx
    .insert(stockQuants)
    .values({ productId, locationId, quantity: delta })
    .onConflictDoUpdate({
      target: [stockQuants.productId, stockQuants.locationId],
      set: {
        quantity: sql`${stockQuants.quantity} + ${delta}`,
        updatedAt: new Date(),
      },
    });
}

/**
 * Allocate the next document reference for a kind, e.g. WH/IN/00007.
 *
 * Reads the current maximum and adds one. Under concurrent creation two callers
 * could pick the same number; the unique index on `operations.reference` turns
 * that into a failed insert rather than a duplicate, and the caller can retry.
 */
export async function nextReference(tx: Executor, kind: OperationKind): Promise<string> {
  const rows = await tx
    .select({ reference: operations.reference })
    .from(operations)
    .where(eq(operations.kind, kind));

  const highest = rows.reduce((max, row) => {
    const tail = Number(row.reference.split('/').at(-1));
    return Number.isFinite(tail) && tail > max ? tail : max;
  }, 0);

  return `${REFERENCE_PREFIX[kind]}/${String(highest + 1).padStart(5, '0')}`;
}

export type ApplyMoveInput = {
  reference: string;
  operationId?: string | undefined;
  productId: string;
  fromLocationId: string;
  toLocationId: string;
  /** Physical amount moved. Always positive — direction comes from the locations. */
  quantity: number;
  kind: OperationKind;
  doneById?: string | undefined;
  doneAt?: Date | undefined;
};

/**
 * Record one stock movement and update the affected quants.
 *
 * Must be called inside a transaction. Queries run sequentially on purpose: a
 * single Postgres connection cannot service concurrent statements, so
 * Promise.all here would break the transaction.
 */
export async function applyMove(tx: Executor, input: ApplyMoveInput): Promise<void> {
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    throw new Error(
      `applyMove needs a positive quantity, received ${input.quantity}. ` +
        'Direction is expressed by the source and destination locations.',
    );
  }

  const from = await requireLocation(tx, input.fromLocationId);
  const to = await requireLocation(tx, input.toLocationId);

  if (from.id === to.id) {
    throw new Error(`Source and destination are the same location (${from.fullName})`);
  }

  const fromInternal = from.kind === 'Internal';
  const toInternal = to.kind === 'Internal';

  // Only internal locations carry tracked stock; vendors and customers do not.
  if (fromInternal) await adjustQuant(tx, input.productId, from.id, -input.quantity);
  if (toInternal) await adjustQuant(tx, input.productId, to.id, input.quantity);

  const signedQuantity =
    fromInternal === toInternal ? 0 : toInternal ? input.quantity : -input.quantity;

  await tx.insert(stockMoves).values({
    reference: input.reference,
    ...(input.operationId !== undefined && { operationId: input.operationId }),
    productId: input.productId,
    fromLocationId: from.id,
    toLocationId: to.id,
    quantity: signedQuantity,
    kind: input.kind,
    status: 'Done',
    ...(input.doneById !== undefined && { doneById: input.doneById }),
    ...(input.doneAt !== undefined && { doneAt: input.doneAt }),
  });
}
