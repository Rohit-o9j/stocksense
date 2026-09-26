/**
 * Server functions backing the inventory UI.
 *
 * These run only on the server. Each one returns data already shaped like the
 * types in `src/lib/stock.tsx`, so the client store is a thin cache over them
 * and the page components did not have to change.
 *
 * Every quantity change goes through the stock engine inside a transaction —
 * nothing here writes `stock_quants` directly.
 */
import { createServerFn } from '@tanstack/react-start';
import { and, desc, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';

import { db, type Executor } from '../db';
import { applyMove, getOnHand, nextReference } from '../db/stock-engine';
import { requireManager, requireUser } from './guards';
import {
  categories,
  locations,
  operationLines,
  operations,
  products,
  reorderingRules,
  stockMoves,
  stockQuants,
  users,
  warehouses,
} from '../db/schema';

// ---------------------------------------------------------------------------
// Shapes returned to the client — mirror src/lib/stock.tsx
// ---------------------------------------------------------------------------

export type Status = 'Draft' | 'Waiting' | 'Ready' | 'Done' | 'Canceled';
export type Kind = 'Receipt' | 'Delivery' | 'Internal Transfer' | 'Adjustment';

export type ProductDto = {
  id: string;
  name: string;
  sku: string;
  category: string;
  unit: string;
  onHand: number;
  minimum: number;
  maximum: number;
  location: string;
};

export type LineDto = { productId: string; demand: number; received: number };

/** One row of the real per-location breakdown behind a product's total. */
export type QuantDto = {
  productId: string;
  location: string;
  warehouse: string;
  quantity: number;
};

export type OperationDto = {
  id: string;
  kind: Kind;
  status: Status;
  partner: string;
  date: string;
  location: string;
  source: string;
  lines: LineDto[];
};

export type MoveDto = {
  id: string;
  date: string;
  reference: string;
  productId: string;
  from: string;
  to: string;
  quantity: number;
  kind: Kind;
  status: Status;
  by: string;
};

export type WarehouseDto = {
  id: string;
  name: string;
  code: string;
  address: string;
};

export type LocationDto = {
  id: string;
  name: string;
  fullName: string;
  kind: 'Internal' | 'Vendor' | 'Customer' | 'Inventory Loss';
  warehouseCode: string | null;
};

export type SnapshotDto = {
  products: ProductDto[];
  operations: OperationDto[];
  moves: MoveDto[];
  categories: string[];
  /** Internal location names, for filter dropdowns. */
  locations: string[];
  warehouses: WarehouseDto[];
  /** Every location including virtual ones, for the settings screen. */
  locationRows: LocationDto[];
  /** On-hand per (product, location). A product can sit in several places. */
  quants: QuantDto[];
};

const STATUSES = ['Draft', 'Waiting', 'Ready', 'Done', 'Canceled'] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function locationIdByName(tx: Executor, fullName: string): Promise<string> {
  const [row] = await tx
    .select({ id: locations.id })
    .from(locations)
    .where(eq(locations.fullName, fullName))
    .limit(1);

  if (!row) {
    throw new Error(`Location "${fullName}" does not exist. Run: bun run db:seed`);
  }
  return row.id;
}

/** ISO string trimmed to the minute, which is the format the tables render. */
function toMinute(value: Date): string {
  return value.toISOString().slice(0, 16);
}

/** Any real storage location, used as a default so nothing depends on a name. */
async function firstInternalLocationId(tx: Executor): Promise<string> {
  const [row] = await tx
    .select({ id: locations.id })
    .from(locations)
    .where(and(eq(locations.kind, 'Internal'), eq(locations.active, true)))
    .orderBy(locations.fullName)
    .limit(1);

  if (!row) {
    throw new Error('No storage locations exist yet. Run: bun run db:seed');
  }
  return row.id;
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

async function loadSnapshot(): Promise<SnapshotDto> {
  const sourceLocation = alias(locations, 'source_location');
  const destLocation = alias(locations, 'dest_location');
  const fromLocation = alias(locations, 'from_location');
  const toLocation = alias(locations, 'to_location');

  const productRows = await db
    .select({
      id: products.id,
      name: products.name,
      sku: products.sku,
      unit: products.unit,
      category: categories.name,
    })
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .where(eq(products.active, true))
    .orderBy(products.name);

  const quantRows = await db
    .select({
      productId: stockQuants.productId,
      quantity: stockQuants.quantity,
      fullName: locations.fullName,
      warehouseName: warehouses.name,
    })
    .from(stockQuants)
    .innerJoin(locations, eq(locations.id, stockQuants.locationId))
    .leftJoin(warehouses, eq(warehouses.id, locations.warehouseId))
    .orderBy(locations.fullName);

  const ruleRows = await db
    .select({
      productId: reorderingRules.productId,
      minQty: reorderingRules.minQty,
      maxQty: reorderingRules.maxQty,
      warehouseId: reorderingRules.warehouseId,
    })
    .from(reorderingRules);

  const internalLocations = await db
    .select({ fullName: locations.fullName, warehouseId: locations.warehouseId })
    .from(locations)
    .where(and(eq(locations.kind, 'Internal'), eq(locations.active, true)))
    .orderBy(locations.fullName);

  // Fallback "default location" for a product with no stock anywhere: the first
  // internal location of the warehouse its reordering rule points at.
  const warehouseDefault = new Map<string, string>();
  for (const row of internalLocations) {
    if (row.warehouseId && !warehouseDefault.has(row.warehouseId)) {
      warehouseDefault.set(row.warehouseId, row.fullName);
    }
  }

  const rulesByProduct = new Map(ruleRows.map((row) => [row.productId, row]));
  const quantsByProduct = new Map<string, Array<{ quantity: number; fullName: string }>>();
  for (const row of quantRows) {
    const list = quantsByProduct.get(row.productId) ?? [];
    list.push({ quantity: row.quantity, fullName: row.fullName });
    quantsByProduct.set(row.productId, list);
  }

  const productDtos: ProductDto[] = productRows.map((row) => {
    const quants = quantsByProduct.get(row.id) ?? [];
    const onHand = quants.reduce((total, quant) => total + quant.quantity, 0);
    const rule = rulesByProduct.get(row.id);

    // Primary location is wherever most of the stock sits.
    const primary = quants.reduce<{ quantity: number; fullName: string } | undefined>(
      (best, quant) => (best === undefined || quant.quantity > best.quantity ? quant : best),
      undefined,
    );

    const fallback =
      (rule?.warehouseId ? warehouseDefault.get(rule.warehouseId) : undefined) ??
      internalLocations[0]?.fullName ??
      '';

    return {
      id: row.id,
      name: row.name,
      sku: row.sku,
      category: row.category ?? 'Uncategorized',
      unit: row.unit,
      onHand,
      minimum: rule?.minQty ?? 0,
      maximum: rule?.maxQty ?? 0,
      location: primary && primary.quantity > 0 ? primary.fullName : fallback,
    };
  });

  const operationRows = await db
    .select({
      id: operations.id,
      reference: operations.reference,
      kind: operations.kind,
      status: operations.status,
      partner: operations.partner,
      scheduledDate: operations.scheduledDate,
      sourceDocument: operations.sourceDocument,
      createdAt: operations.createdAt,
      sourceName: sourceLocation.fullName,
      destName: destLocation.fullName,
    })
    .from(operations)
    .leftJoin(sourceLocation, eq(sourceLocation.id, operations.sourceLocationId))
    .leftJoin(destLocation, eq(destLocation.id, operations.destLocationId))
    .orderBy(desc(operations.createdAt));

  const lineRows = await db
    .select({
      operationId: operationLines.operationId,
      productId: operationLines.productId,
      demandQty: operationLines.demandQty,
      receivedQty: operationLines.receivedQty,
      sortOrder: operationLines.sortOrder,
    })
    .from(operationLines)
    .orderBy(operationLines.sortOrder);

  const linesByOperation = new Map<string, LineDto[]>();
  for (const row of lineRows) {
    const list = linesByOperation.get(row.operationId) ?? [];
    list.push({ productId: row.productId, demand: row.demandQty, received: row.receivedQty });
    linesByOperation.set(row.operationId, list);
  }

  const operationDtos: OperationDto[] = operationRows.map((row) => {
    // The UI shows one location per document; which end is meaningful depends
    // on the kind. Receipts land somewhere, everything else leaves somewhere.
    const location =
      row.kind === 'Receipt' ? (row.destName ?? '') : (row.sourceName ?? '');

    // For a transfer the counterparty is the destination, not a trading partner.
    const partner =
      row.kind === 'Internal Transfer' ? (row.destName ?? '') : (row.partner ?? '');

    return {
      id: row.reference,
      kind: row.kind,
      status: row.status,
      partner,
      date: row.scheduledDate ?? '',
      location,
      source: row.sourceDocument ?? '',
      lines: linesByOperation.get(row.id) ?? [],
    };
  });

  const moveRows = await db
    .select({
      id: stockMoves.id,
      reference: stockMoves.reference,
      productId: stockMoves.productId,
      quantity: stockMoves.quantity,
      kind: stockMoves.kind,
      status: stockMoves.status,
      doneAt: stockMoves.doneAt,
      from: fromLocation.fullName,
      to: toLocation.fullName,
      by: users.name,
    })
    .from(stockMoves)
    .innerJoin(fromLocation, eq(fromLocation.id, stockMoves.fromLocationId))
    .innerJoin(toLocation, eq(toLocation.id, stockMoves.toLocationId))
    .leftJoin(users, eq(users.id, stockMoves.doneById))
    .orderBy(desc(stockMoves.doneAt));

  const moveDtos: MoveDto[] = moveRows.map((row) => ({
    id: row.id,
    date: toMinute(row.doneAt),
    reference: row.reference,
    productId: row.productId,
    from: row.from,
    to: row.to,
    quantity: row.quantity,
    kind: row.kind,
    status: row.status,
    by: row.by ?? '',
  }));

  const categoryRows = await db
    .select({ name: categories.name })
    .from(categories)
    .orderBy(categories.name);

  const warehouseRows = await db
    .select({
      id: warehouses.id,
      name: warehouses.name,
      code: warehouses.code,
      address: warehouses.address,
    })
    .from(warehouses)
    .orderBy(warehouses.name);

  const allLocations = await db
    .select({
      id: locations.id,
      name: locations.name,
      fullName: locations.fullName,
      kind: locations.kind,
      warehouseCode: warehouses.code,
    })
    .from(locations)
    .leftJoin(warehouses, eq(warehouses.id, locations.warehouseId))
    .where(eq(locations.active, true))
    .orderBy(locations.fullName);

  return {
    products: productDtos,
    operations: operationDtos,
    moves: moveDtos,
    categories: categoryRows.map((row) => row.name),
    locations: internalLocations.map((row) => row.fullName),
    warehouses: warehouseRows.map((row) => ({
      id: row.id,
      name: row.name,
      code: row.code,
      address: row.address ?? '',
    })),
    locationRows: allLocations,
    // Only rows that actually hold stock; zero quants are noise on screen.
    quants: quantRows
      .filter((row) => row.quantity !== 0)
      .map((row) => ({
        productId: row.productId,
        location: row.fullName,
        warehouse: row.warehouseName ?? row.fullName.split(' / ')[0] ?? '',
        quantity: row.quantity,
      })),
  };
}

export const getSnapshot = createServerFn({ method: 'GET' }).handler(
  async (): Promise<SnapshotDto> => {
    // Inventory is not public data.
    await requireUser();
    return loadSnapshot();
  },
);

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export const createReceipt = createServerFn({ method: 'POST' }).handler(
  async (): Promise<string> => {
    const actor = await requireUser();
    return db.transaction(async (tx) => {
      const reference = await nextReference(tx, 'Receipt');
      const vendors = await locationIdByName(tx, 'Vendors');
      // Don't hardcode a warehouse name — use whichever internal location exists.
      const destination = await firstInternalLocationId(tx);

      await tx.insert(operations).values({
        reference,
        kind: 'Receipt',
        status: 'Draft',
        partner: '',
        scheduledDate: new Date().toISOString().slice(0, 10),
        sourceLocationId: vendors,
        destLocationId: destination,
        createdById: actor.id,
      });

      return reference;
    });
  },
);

const updateOperationInput = z.object({
  reference: z.string().min(1),
  patch: z.object({
    partner: z.string().optional(),
    date: z.string().optional(),
    location: z.string().optional(),
    source: z.string().optional(),
    status: z.enum(STATUSES).optional(),
    lines: z
      .array(
        z.object({
          productId: z.string().min(1),
          demand: z.number(),
          received: z.number(),
        }),
      )
      .optional(),
  }),
});

export const updateOperation = createServerFn({ method: 'POST' })
  .validator((input: unknown) => updateOperationInput.parse(input))
  .handler(async ({ data }): Promise<void> => {
    await requireUser();
    const { reference, patch } = data;

    if (patch.status === 'Done') {
      throw new Error(
        'Set status to Done by validating the document, so stock moves are recorded.',
      );
    }

    await db.transaction(async (tx) => {
      const [operation] = await tx
        .select({ id: operations.id, kind: operations.kind, status: operations.status })
        .from(operations)
        .where(eq(operations.reference, reference))
        .limit(1);

      if (!operation) throw new Error(`Document ${reference} does not exist`);
      if (operation.status === 'Done') {
        throw new Error(`${reference} is already validated and cannot be edited`);
      }

      const changes: Record<string, unknown> = {};
      if (patch.partner !== undefined) changes['partner'] = patch.partner;
      if (patch.date !== undefined) changes['scheduledDate'] = patch.date;
      if (patch.source !== undefined) changes['sourceDocument'] = patch.source;
      if (patch.status !== undefined) changes['status'] = patch.status;

      if (patch.location !== undefined) {
        const locationId = await locationIdByName(tx, patch.location);
        // Receipts arrive at the chosen location; everything else leaves from it.
        if (operation.kind === 'Receipt') changes['destLocationId'] = locationId;
        else changes['sourceLocationId'] = locationId;
      }

      if (Object.keys(changes).length > 0) {
        await tx.update(operations).set(changes).where(eq(operations.id, operation.id));
      }

      if (patch.lines !== undefined) {
        await tx.delete(operationLines).where(eq(operationLines.operationId, operation.id));

        let sortOrder = 0;
        for (const line of patch.lines) {
          await tx.insert(operationLines).values({
            operationId: operation.id,
            productId: line.productId,
            demandQty: line.demand,
            receivedQty: line.received,
            picked: line.received > 0,
            sortOrder: sortOrder++,
          });
        }
      }
    });
  });

const referenceInput = z.object({ reference: z.string().min(1) });

/**
 * Validate a document: write the ledger moves and update on-hand quantities,
 * then mark it Done. Runs in one transaction, so a rejected line leaves the
 * document untouched rather than half applied.
 */
export const validateOperation = createServerFn({ method: 'POST' })
  .validator((input: unknown) => referenceInput.parse(input))
  .handler(async ({ data }): Promise<void> => {
    const actor = await requireUser();

    await db.transaction(async (tx) => {
      const [operation] = await tx
        .select({
          id: operations.id,
          reference: operations.reference,
          kind: operations.kind,
          status: operations.status,
          sourceLocationId: operations.sourceLocationId,
          destLocationId: operations.destLocationId,
          createdById: operations.createdById,
        })
        .from(operations)
        .where(eq(operations.reference, data.reference))
        .limit(1);

      if (!operation) throw new Error(`Document ${data.reference} does not exist`);
      if (operation.status !== 'Ready') {
        throw new Error(
          `${operation.reference} is ${operation.status}. Mark it Ready before validating.`,
        );
      }
      if (!operation.sourceLocationId || !operation.destLocationId) {
        throw new Error(`${operation.reference} is missing a source or destination location`);
      }

      const lines = await tx
        .select({
          productId: operationLines.productId,
          receivedQty: operationLines.receivedQty,
        })
        .from(operationLines)
        .where(eq(operationLines.operationId, operation.id));

      const movable = lines.filter((line) => line.receivedQty !== 0);
      if (movable.length === 0) {
        throw new Error(`${operation.reference} has no quantities to move`);
      }

      const now = new Date();

      for (const line of movable) {
        // An adjustment can go either way; its sign decides the direction.
        const outbound = operation.kind === 'Adjustment' && line.receivedQty < 0;
        const inbound = operation.kind === 'Adjustment' && line.receivedQty > 0;

        const fromLocationId = inbound ? operation.destLocationId : operation.sourceLocationId;
        const toLocationId = inbound ? operation.sourceLocationId : operation.destLocationId;
        const quantity = Math.abs(line.receivedQty);

        // Never let stock go negative at the source.
        if (operation.kind === 'Delivery' || operation.kind === 'Internal Transfer' || outbound) {
          const available = await getOnHand(tx, line.productId, fromLocationId);
          if (available < quantity) {
            throw new Error(
              `Only ${available} available at the source location, ${quantity} required. ` +
                `${operation.reference} was not validated.`,
            );
          }
        }

        await applyMove(tx, {
          reference: operation.reference,
          operationId: operation.id,
          productId: line.productId,
          fromLocationId,
          toLocationId,
          quantity,
          kind: operation.kind,
          // The ledger records who actually moved the stock, not who drafted it.
          doneById: actor.id,
          doneAt: now,
        });
      }

      await tx
        .update(operations)
        .set({ status: 'Done', validatedAt: now })
        .where(eq(operations.id, operation.id));
    });
  });

const ADJUSTMENT_REASONS = ['Damaged', 'Lost', 'Found', 'Miscount', 'Other'] as const;

const adjustmentInput = z.object({
  counts: z.record(z.string(), z.number()),
  /** Per-product reason, keyed by product id. Missing entries default to Miscount. */
  reasons: z.record(z.string(), z.enum(ADJUSTMENT_REASONS)).optional(),
  /** Label for the document as a whole. */
  note: z.string().trim().min(1).optional(),
});

/**
 * Apply a counting sheet. Creates one Adjustment document covering every line
 * whose counted quantity differs from what is on record, and moves the
 * difference to or from Inventory Loss.
 *
 * Returns the number of lines actually adjusted.
 */
export const applyAdjustment = createServerFn({ method: 'POST' })
  .validator((input: unknown) => adjustmentInput.parse(input))
  .handler(async ({ data }): Promise<number> => {
    const actor = await requireUser();

    return db.transaction(async (tx) => {
      const loss = await locationIdByName(tx, 'Inventory Loss');
      const entries = Object.entries(data.counts);
      if (entries.length === 0) return 0;

      type Change = {
        productId: string;
        locationId: string;
        difference: number;
        reason: (typeof ADJUSTMENT_REASONS)[number];
      };

      const changes: Change[] = [];

      for (const [productId, counted] of entries) {
        if (!Number.isFinite(counted)) continue;

        // Count against wherever the stock currently sits.
        const quants = await tx
          .select({ locationId: stockQuants.locationId, quantity: stockQuants.quantity })
          .from(stockQuants)
          .where(eq(stockQuants.productId, productId));

        const primary = quants.reduce<{ locationId: string; quantity: number } | undefined>(
          (best, quant) => (best === undefined || quant.quantity > best.quantity ? quant : best),
          undefined,
        );

        const locationId = primary?.locationId ?? (await locationIdByName(tx, 'Main / Stock'));
        const current = quants.reduce((total, quant) => total + quant.quantity, 0);
        const difference = counted - current;

        if (difference !== 0) {
          changes.push({
            productId,
            locationId,
            difference,
            reason: data.reasons?.[productId] ?? 'Miscount',
          });
        }
      }

      if (changes.length === 0) return 0;

      const reference = await nextReference(tx, 'Adjustment');
      const now = new Date();
      const anchor = changes[0];
      if (!anchor) return 0;

      const [created] = await tx
        .insert(operations)
        .values({
          reference,
          kind: 'Adjustment',
          status: 'Done',
          partner: data.note ?? 'Cycle count',
          scheduledDate: now.toISOString().slice(0, 10),
          sourceLocationId: anchor.locationId,
          destLocationId: loss,
          validatedAt: now,
        })
        .returning({ id: operations.id });

      if (!created) throw new Error('Could not create the adjustment document');

      let sortOrder = 0;
      for (const change of changes) {
        await tx.insert(operationLines).values({
          operationId: created.id,
          productId: change.productId,
          demandQty: change.difference,
          receivedQty: change.difference,
          reason: change.reason,
          sortOrder: sortOrder++,
        });

        const increasing = change.difference > 0;
        await applyMove(tx, {
          reference,
          operationId: created.id,
          productId: change.productId,
          fromLocationId: increasing ? loss : change.locationId,
          toLocationId: increasing ? change.locationId : loss,
          quantity: Math.abs(change.difference),
          kind: 'Adjustment',
          doneById: actor.id,
          doneAt: now,
        });
      }

      return changes.length;
    });
  });

// ---------------------------------------------------------------------------
// Master data
// ---------------------------------------------------------------------------

const createProductInput = z.object({
  name: z.string().trim().min(1, 'Enter a product name'),
  sku: z.string().trim().min(1, 'Enter a SKU'),
  category: z.string().trim().min(1, 'Choose a category'),
  unit: z.string().trim().min(1, 'Enter a unit of measure'),
  /** Optional opening stock, recorded as a real receipt so the ledger matches. */
  initialStock: z.number().min(0).optional(),
  location: z.string().trim().optional(),
  minQty: z.number().min(0).optional(),
  maxQty: z.number().min(0).optional(),
});

export const createProduct = createServerFn({ method: 'POST' })
  .validator((input: unknown) => createProductInput.parse(input))
  .handler(async ({ data }): Promise<string> => {
    const actor = await requireManager();

    return db.transaction(async (tx) => {
      const sku = data.sku.toUpperCase();

      const [clash] = await tx
        .select({ id: products.id })
        .from(products)
        .where(eq(products.sku, sku))
        .limit(1);

      if (clash) throw new Error(`SKU ${sku} already exists.`);

      const [category] = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.name, data.category))
        .limit(1);

      if (!category) throw new Error(`Category "${data.category}" does not exist.`);

      const [created] = await tx
        .insert(products)
        .values({
          name: data.name.trim(),
          sku,
          unit: data.unit.trim(),
          categoryId: category.id,
        })
        .returning({ id: products.id });

      if (!created) throw new Error('Could not create the product.');

      const locationId = data.location
        ? await locationIdByName(tx, data.location)
        : await firstInternalLocationId(tx);

      // A reordering rule is what drives low-stock alerts, so create one whenever
      // either bound was supplied.
      if (data.minQty !== undefined || data.maxQty !== undefined) {
        const [warehouseRow] = await tx
          .select({ warehouseId: locations.warehouseId })
          .from(locations)
          .where(eq(locations.id, locationId))
          .limit(1);

        if (warehouseRow?.warehouseId) {
          await tx.insert(reorderingRules).values({
            productId: created.id,
            warehouseId: warehouseRow.warehouseId,
            minQty: data.minQty ?? 0,
            maxQty: data.maxQty ?? 0,
          });
        }
      }

      if (data.initialStock !== undefined && data.initialStock > 0) {
        const reference = await nextReference(tx, 'Receipt');
        const vendors = await locationIdByName(tx, 'Vendors');
        const now = new Date();

        const [operation] = await tx
          .insert(operations)
          .values({
            reference,
            kind: 'Receipt',
            status: 'Done',
            partner: 'Opening stock',
            scheduledDate: now.toISOString().slice(0, 10),
            sourceLocationId: vendors,
            destLocationId: locationId,
            createdById: actor.id,
            validatedAt: now,
          })
          .returning({ id: operations.id });

        if (operation) {
          await tx.insert(operationLines).values({
            operationId: operation.id,
            productId: created.id,
            demandQty: data.initialStock,
            receivedQty: data.initialStock,
            picked: true,
          });

          await applyMove(tx, {
            reference,
            operationId: operation.id,
            productId: created.id,
            fromLocationId: vendors,
            toLocationId: locationId,
            quantity: data.initialStock,
            kind: 'Receipt',
            doneById: actor.id,
            doneAt: now,
          });
        }
      }

      return created.id;
    });
  });

const nameInput = z.object({ name: z.string().trim().min(1, 'Enter a name') });

export const createCategory = createServerFn({ method: 'POST' })
  .validator((input: unknown) => nameInput.parse(input))
  .handler(async ({ data }): Promise<void> => {
    await requireManager();
    const name = data.name.trim();

    const [clash] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.name, name))
      .limit(1);

    if (clash) throw new Error(`Category "${name}" already exists.`);

    await db.insert(categories).values({ name });
  });

const ruleInput = z.object({
  productId: z.string().min(1),
  minQty: z.number().min(0),
  maxQty: z.number().min(0),
});

/** Creates or updates the rule for a product at whichever warehouse holds it. */
export const saveReorderingRule = createServerFn({ method: 'POST' })
  .validator((input: unknown) => ruleInput.parse(input))
  .handler(async ({ data }): Promise<void> => {
    await requireManager();

    if (data.maxQty > 0 && data.maxQty < data.minQty) {
      throw new Error('Maximum must be greater than or equal to minimum.');
    }

    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: reorderingRules.id })
        .from(reorderingRules)
        .where(eq(reorderingRules.productId, data.productId))
        .limit(1);

      if (existing) {
        await tx
          .update(reorderingRules)
          .set({ minQty: data.minQty, maxQty: data.maxQty })
          .where(eq(reorderingRules.id, existing.id));
        return;
      }

      const locationId = await firstInternalLocationId(tx);
      const [row] = await tx
        .select({ warehouseId: locations.warehouseId })
        .from(locations)
        .where(eq(locations.id, locationId))
        .limit(1);

      if (!row?.warehouseId) throw new Error('No warehouse exists to attach the rule to.');

      await tx.insert(reorderingRules).values({
        productId: data.productId,
        warehouseId: row.warehouseId,
        minQty: data.minQty,
        maxQty: data.maxQty,
      });
    });
  });

const warehouseInput = z.object({
  name: z.string().trim().min(1, 'Enter a warehouse name'),
  code: z.string().trim().min(1, 'Enter a short code').max(8),
  address: z.string().trim().optional(),
});

export const createWarehouse = createServerFn({ method: 'POST' })
  .validator((input: unknown) => warehouseInput.parse(input))
  .handler(async ({ data }): Promise<void> => {
    await requireManager();
    const code = data.code.toUpperCase();

    const [clash] = await db
      .select({ id: warehouses.id })
      .from(warehouses)
      .where(eq(warehouses.code, code))
      .limit(1);

    if (clash) throw new Error(`A warehouse with code ${code} already exists.`);

    await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(warehouses)
        .values({
          name: data.name.trim(),
          code,
          ...(data.address ? { address: data.address.trim() } : {}),
        })
        .returning({ id: warehouses.id });

      if (!created) throw new Error('Could not create the warehouse.');

      // A warehouse with no location cannot receive stock, so give it one.
      await tx.insert(locations).values({
        warehouseId: created.id,
        name: 'Stock',
        fullName: `${data.name.trim()} / Stock`,
        kind: 'Internal',
      });
    });
  });

const locationInput = z.object({
  warehouseCode: z.string().trim().min(1),
  name: z.string().trim().min(1, 'Enter a location name'),
});

export const createLocation = createServerFn({ method: 'POST' })
  .validator((input: unknown) => locationInput.parse(input))
  .handler(async ({ data }): Promise<void> => {
    await requireManager();

    const [warehouse] = await db
      .select({ id: warehouses.id, name: warehouses.name })
      .from(warehouses)
      .where(eq(warehouses.code, data.warehouseCode.toUpperCase()))
      .limit(1);

    if (!warehouse) throw new Error('That warehouse does not exist.');

    const name = data.name.trim();
    const fullName = `${warehouse.name} / ${name}`;

    const [clash] = await db
      .select({ id: locations.id })
      .from(locations)
      .where(eq(locations.fullName, fullName))
      .limit(1);

    if (clash) throw new Error(`Location "${fullName}" already exists.`);

    await db.insert(locations).values({
      warehouseId: warehouse.id,
      name,
      fullName,
      kind: 'Internal',
    });
  });
