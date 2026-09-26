/**
 * The demonstration dataset, and the routines that load it.
 *
 * Shared by the `db:seed` CLI and the admin dashboard, so there is exactly one
 * copy of the data and one implementation of the seeding logic.
 *
 * Everything here takes an `Executor`, so callers decide the transaction
 * boundary. Stock is always created by running real moves through the stock
 * engine rather than by writing quantities directly, which is what keeps the
 * ledger and on-hand figures in agreement.
 */
import { and, eq, isNull, sql } from "drizzle-orm";

import type { Executor } from "./index";
import { applyMove } from "./stock-engine";
import {
  categories,
  locations,
  operationLines,
  operations,
  passwordResetOtps,
  products,
  reorderingRules,
  stockMoves,
  stockQuants,
  users,
  warehouses,
  type NewOperation,
} from "./schema";
import { hashPassword } from "../server/password";

// ---------------------------------------------------------------------------
// Dataset
// ---------------------------------------------------------------------------

export const CATEGORY_NAMES = ["Raw Materials", "Finished Goods", "Consumables", "Packaging"];

const WAREHOUSES = [
  { name: "Main Warehouse", code: "WH", address: "14 Ironworks Road, Sheffield" },
  { name: "East Warehouse", code: "EAST", address: "8 Harbour Way, Felixstowe" },
];

const INTERNAL_LOCATIONS = [
  { fullName: "Main / Stock", name: "Stock", warehouse: "WH" },
  { fullName: "Main / Rack A", name: "Rack A", warehouse: "WH" },
  { fullName: "Main / Rack B", name: "Rack B", warehouse: "WH" },
  { fullName: "Production Rack", name: "Production Rack", warehouse: "WH" },
  { fullName: "East / Stock", name: "Stock", warehouse: "EAST" },
  { fullName: "East / Rack A", name: "Rack A", warehouse: "EAST" },
];

/** Counterparties, modelled as locations so every operation is a move. */
const VIRTUAL_LOCATIONS = [
  { fullName: "Vendors", name: "Vendors", kind: "Vendor" as const },
  { fullName: "Customers", name: "Customers", kind: "Customer" as const },
  { fullName: "Inventory Loss", name: "Inventory Loss", kind: "Inventory Loss" as const },
];

export const DEV_PASSWORD = "StockSense!2026";

export const DEMO_USERS = [
  { name: "Alex Morgan", email: "alex@stocksense.test", role: "Inventory Manager" as const },
  { name: "Jordan Lee", email: "jordan@stocksense.test", role: "Warehouse Staff" as const },
];

const PRODUCTS = [
  {
    sku: "RAW-STEEL-001",
    name: "Steel Rods",
    category: "Raw Materials",
    unit: "kg",
    min: 30,
    max: 180,
    location: "Main / Stock",
  },
  {
    sku: "RAW-ALU-002",
    name: "Aluminum Sheets",
    category: "Raw Materials",
    unit: "sheets",
    min: 25,
    max: 100,
    location: "Main / Rack A",
  },
  {
    sku: "RAW-COP-003",
    name: "Copper Wire",
    category: "Raw Materials",
    unit: "m",
    min: 20,
    max: 90,
    location: "Main / Rack B",
  },
  {
    sku: "FIN-KIT-004",
    name: "Assembly Kit A",
    category: "Finished Goods",
    unit: "units",
    min: 15,
    max: 80,
    location: "Main / Stock",
  },
  {
    sku: "FIN-KIT-005",
    name: "Assembly Kit B",
    category: "Finished Goods",
    unit: "units",
    min: 15,
    max: 70,
    location: "East / Stock",
  },
  {
    sku: "FIN-VAL-006",
    name: "Industrial Valve",
    category: "Finished Goods",
    unit: "units",
    min: 10,
    max: 55,
    location: "East / Stock",
  },
  {
    sku: "CON-LUB-007",
    name: "Lubricant",
    category: "Consumables",
    unit: "L",
    min: 12,
    max: 45,
    location: "Main / Stock",
  },
  {
    sku: "CON-GLV-008",
    name: "Safety Gloves",
    category: "Consumables",
    unit: "pairs",
    min: 20,
    max: 100,
    location: "East / Stock",
  },
  {
    sku: "PAC-TAP-009",
    name: "Packing Tape",
    category: "Packaging",
    unit: "rolls",
    min: 18,
    max: 70,
    location: "Main / Stock",
  },
  {
    sku: "PAC-BOX-010",
    name: "Shipping Box M",
    category: "Packaging",
    unit: "units",
    min: 30,
    max: 140,
    location: "East / Stock",
  },
  {
    sku: "PAC-WRP-011",
    name: "Pallet Wrap",
    category: "Packaging",
    unit: "rolls",
    min: 25,
    max: 90,
    location: "Main / Stock",
  },
  {
    sku: "RAW-FAS-012",
    name: "Fasteners",
    category: "Raw Materials",
    unit: "boxes",
    min: 30,
    max: 110,
    location: "Main / Rack A",
  },
];

/** `received - delivered` is what remains on hand for each product. */
const OPENING: Record<string, { received: number; delivered: number }> = {
  "RAW-ALU-002": { received: 12, delivered: 0 },
  "RAW-COP-003": { received: 8, delivered: 0 },
  "FIN-KIT-004": { received: 40, delivered: 8 },
  "FIN-KIT-005": { received: 4, delivered: 0 },
  "FIN-VAL-006": { received: 12, delivered: 12 },
  "CON-LUB-007": { received: 3, delivered: 0 },
  "CON-GLV-008": { received: 15, delivered: 6 },
  "PAC-TAP-009": { received: 6, delivered: 0 },
  "PAC-BOX-010": { received: 30, delivered: 30 },
  "PAC-WRP-011": { received: 20, delivered: 9 },
  "RAW-FAS-012": { received: 40, delivered: 6 },
};

const PENDING: Array<{
  reference: string;
  kind: NewOperation["kind"];
  status: NewOperation["status"];
  partner: string;
  date: string;
  source: string;
  from: string;
  to: string;
  lines: Array<{ sku: string; demand: number; received: number }>;
}> = [
  {
    reference: "WH/IN/00003",
    kind: "Receipt",
    status: "Ready",
    partner: "Atlas Industrial Supply",
    date: "2026-09-28",
    source: "PO-2026-112",
    from: "Vendors",
    to: "Main / Stock",
    lines: [
      { sku: "RAW-ALU-002", demand: 30, received: 30 },
      { sku: "RAW-COP-003", demand: 25, received: 25 },
    ],
  },
  {
    reference: "WH/IN/00004",
    kind: "Receipt",
    status: "Waiting",
    partner: "Pacific Materials",
    date: "2026-09-29",
    source: "PO-2026-113",
    from: "Vendors",
    to: "Main / Rack B",
    lines: [{ sku: "CON-LUB-007", demand: 20, received: 0 }],
  },
  {
    reference: "WH/IN/00005",
    kind: "Receipt",
    status: "Draft",
    partner: "Northline Metals",
    date: "2026-10-01",
    source: "",
    from: "Vendors",
    to: "Main / Stock",
    lines: [{ sku: "RAW-FAS-012", demand: 40, received: 0 }],
  },
  {
    reference: "WH/IN/00006",
    kind: "Receipt",
    status: "Canceled",
    partner: "Atlas Industrial Supply",
    date: "2026-09-18",
    source: "PO-2026-109",
    from: "Vendors",
    to: "East / Stock",
    lines: [{ sku: "CON-GLV-008", demand: 10, received: 0 }],
  },
  {
    reference: "WH/OUT/00003",
    kind: "Delivery",
    status: "Ready",
    partner: "Westbridge Works",
    date: "2026-09-27",
    source: "SO-121",
    from: "Main / Stock",
    to: "Customers",
    lines: [{ sku: "FIN-KIT-004", demand: 5, received: 5 }],
  },
  {
    reference: "WH/OUT/00004",
    kind: "Delivery",
    status: "Waiting",
    partner: "Porter Group",
    date: "2026-09-29",
    source: "SO-122",
    from: "East / Stock",
    to: "Customers",
    lines: [{ sku: "FIN-KIT-005", demand: 6, received: 0 }],
  },
  {
    reference: "WH/OUT/00005",
    kind: "Delivery",
    status: "Draft",
    partner: "Orion Labs",
    date: "2026-10-02",
    source: "",
    from: "Main / Stock",
    to: "Customers",
    lines: [{ sku: "PAC-WRP-011", demand: 4, received: 0 }],
  },
  {
    reference: "WH/INT/00002",
    kind: "Internal Transfer",
    status: "Ready",
    partner: "Production Rack",
    date: "2026-09-28",
    source: "",
    from: "Main / Rack A",
    to: "Production Rack",
    lines: [{ sku: "RAW-ALU-002", demand: 5, received: 5 }],
  },
  {
    reference: "WH/INT/00003",
    kind: "Internal Transfer",
    status: "Draft",
    partner: "East / Stock",
    date: "2026-10-01",
    source: "",
    from: "Main / Stock",
    to: "East / Stock",
    lines: [{ sku: "PAC-TAP-009", demand: 3, received: 0 }],
  },
  {
    reference: "WH/ADJ/00002",
    kind: "Adjustment",
    status: "Draft",
    partner: "Cycle count",
    date: "2026-09-30",
    source: "",
    from: "Main / Stock",
    to: "Inventory Loss",
    lines: [{ sku: "PAC-TAP-009", demand: 0, received: 0 }],
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function warehouseCodeFor(locationFullName: string): string {
  return locationFullName.startsWith("East") ? "EAST" : "WH";
}

function requireId(map: Map<string, string>, key: string, what: string): string {
  const id = map.get(key);
  if (!id) throw new Error(`Seed error: ${what} "${key}" was not created`);
  return id;
}

async function categoryIdByName(tx: Executor, name: string): Promise<string | undefined> {
  const [row] = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.name, name))
    .limit(1);
  return row?.id;
}

async function warehouseIdByCode(tx: Executor, code: string): Promise<string | undefined> {
  const [row] = await tx
    .select({ id: warehouses.id })
    .from(warehouses)
    .where(eq(warehouses.code, code))
    .limit(1);
  return row?.id;
}

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

export type BaselineResult = {
  categories: number;
  warehouses: number;
  locations: number;
  users: number;
};

/**
 * Categories, warehouses, internal and virtual locations, and two demo logins.
 *
 * Idempotent — safe to run against a database that already holds real accounts
 * or partial reference data. Nothing is deleted.
 */
export async function seedBaseline(tx: Executor): Promise<BaselineResult> {
  const result: BaselineResult = { categories: 0, warehouses: 0, locations: 0, users: 0 };

  const categoryIds = new Map<string, string>();
  for (const name of CATEGORY_NAMES) {
    const [inserted] = await tx
      .insert(categories)
      .values({ name })
      .onConflictDoNothing({ target: categories.name })
      .returning({ id: categories.id });

    if (inserted) {
      categoryIds.set(name, inserted.id);
      result.categories += 1;
    } else {
      const existing = await categoryIdByName(tx, name);
      if (existing) categoryIds.set(name, existing);
    }
  }

  const warehouseIds = new Map<string, string>();
  for (const warehouse of WAREHOUSES) {
    const [inserted] = await tx
      .insert(warehouses)
      .values(warehouse)
      .onConflictDoNothing({ target: warehouses.code })
      .returning({ id: warehouses.id });

    if (inserted) {
      warehouseIds.set(warehouse.code, inserted.id);
      result.warehouses += 1;
    } else {
      const existing = await warehouseIdByCode(tx, warehouse.code);
      if (existing) warehouseIds.set(warehouse.code, existing);
    }
  }

  for (const location of INTERNAL_LOCATIONS) {
    const [inserted] = await tx
      .insert(locations)
      .values({
        name: location.name,
        fullName: location.fullName,
        kind: "Internal",
        warehouseId: requireId(warehouseIds, location.warehouse, "warehouse"),
      })
      .onConflictDoNothing({ target: locations.fullName })
      .returning({ id: locations.id });
    if (inserted) result.locations += 1;
  }

  for (const location of VIRTUAL_LOCATIONS) {
    const [inserted] = await tx
      .insert(locations)
      .values({ name: location.name, fullName: location.fullName, kind: location.kind })
      .onConflictDoNothing({ target: locations.fullName })
      .returning({ id: locations.id });
    if (inserted) result.locations += 1;
  }

  for (const user of DEMO_USERS) {
    const [inserted] = await tx
      .insert(users)
      .values({ ...user, passwordHash: await hashPassword(DEV_PASSWORD) })
      .onConflictDoNothing({ target: users.email })
      .returning({ id: users.id });
    if (inserted) result.users += 1;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Demo inventory
// ---------------------------------------------------------------------------

export type DemoResult = {
  products: number;
  completedDocuments: number;
  pendingDocuments: number;
  moves: number;
};

/**
 * The worked example from the problem statement plus enough surrounding
 * activity to populate every screen. Requires `seedBaseline` to have run.
 *
 * Skips silently if products already exist, so it cannot double-post stock.
 */
export async function seedDemo(tx: Executor): Promise<DemoResult> {
  const [anyProduct] = await tx.select({ id: products.id }).from(products).limit(1);
  if (anyProduct) {
    throw new Error(
      "Products already exist. Reset the inventory first if you want a clean demo set.",
    );
  }

  const result: DemoResult = { products: 0, completedDocuments: 0, pendingDocuments: 0, moves: 0 };

  const categoryRows = await tx
    .select({ id: categories.id, name: categories.name })
    .from(categories);
  const categoryIds = new Map(categoryRows.map((row) => [row.name, row.id]));

  const warehouseRows = await tx
    .select({ id: warehouses.id, code: warehouses.code })
    .from(warehouses);
  const warehouseIds = new Map(warehouseRows.map((row) => [row.code, row.id]));

  const locationRows = await tx
    .select({ id: locations.id, fullName: locations.fullName })
    .from(locations);
  const locationIds = new Map(locationRows.map((row) => [row.fullName, row.id]));

  if (locationIds.size === 0) {
    throw new Error("No locations exist. Load the reference data first.");
  }

  const [manager] = await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, "Inventory Manager"))
    .limit(1);
  const [anyone] = await tx.select({ id: users.id }).from(users).limit(1);
  const actorId = manager?.id ?? anyone?.id;

  const productIds = new Map<string, string>();
  for (const product of PRODUCTS) {
    const [created] = await tx
      .insert(products)
      .values({
        name: product.name,
        sku: product.sku,
        unit: product.unit,
        categoryId: requireId(categoryIds, product.category, "category"),
      })
      .returning({ id: products.id });
    if (!created) continue;
    productIds.set(product.sku, created.id);
    result.products += 1;

    await tx.insert(reorderingRules).values({
      productId: created.id,
      warehouseId: requireId(warehouseIds, warehouseCodeFor(product.location), "warehouse"),
      minQty: product.min,
      maxQty: product.max,
    });
  }

  const vendors = requireId(locationIds, "Vendors", "location");
  const customers = requireId(locationIds, "Customers", "location");
  const loss = requireId(locationIds, "Inventory Loss", "location");
  const mainStock = requireId(locationIds, "Main / Stock", "location");
  const productionRack = requireId(locationIds, "Production Rack", "location");

  const createOperation = async (
    operation: Omit<NewOperation, "id">,
    lines: Array<{ sku: string; demand: number; received: number }>,
  ): Promise<string> => {
    const [row] = await tx
      .insert(operations)
      .values({ ...operation, ...(actorId ? { createdById: actorId } : {}) })
      .returning({ id: operations.id });
    if (!row) throw new Error(`Seed error: could not create ${operation.reference}`);

    let sortOrder = 0;
    for (const line of lines) {
      await tx.insert(operationLines).values({
        operationId: row.id,
        productId: requireId(productIds, line.sku, "product"),
        demandQty: line.demand,
        receivedQty: line.received,
        picked: line.received > 0,
        sortOrder: sortOrder++,
      });
    }
    return row.id;
  };

  const move = async (input: {
    reference: string;
    operationId: string;
    sku: string;
    from: string;
    to: string;
    quantity: number;
    kind: NewOperation["kind"];
    at: string;
  }) => {
    await applyMove(tx, {
      reference: input.reference,
      operationId: input.operationId,
      productId: requireId(productIds, input.sku, "product"),
      fromLocationId: input.from,
      toLocationId: input.to,
      quantity: input.quantity,
      kind: input.kind,
      ...(actorId ? { doneById: actorId } : {}),
      doneAt: new Date(input.at),
    });
    result.moves += 1;
  };

  // The worked example: receive 100, move 30 to production, deliver 20, lose 3.
  const steelReceipt = await createOperation(
    {
      reference: "WH/IN/00001",
      kind: "Receipt",
      status: "Done",
      partner: "Northline Metals",
      scheduledDate: "2026-09-20",
      sourceDocument: "PO-2026-111",
      sourceLocationId: vendors,
      destLocationId: mainStock,
      validatedAt: new Date("2026-09-20T09:35:00Z"),
    },
    [{ sku: "RAW-STEEL-001", demand: 100, received: 100 }],
  );
  await move({
    reference: "WH/IN/00001",
    operationId: steelReceipt,
    sku: "RAW-STEEL-001",
    from: vendors,
    to: mainStock,
    quantity: 100,
    kind: "Receipt",
    at: "2026-09-20T09:35:00Z",
  });

  const steelTransfer = await createOperation(
    {
      reference: "WH/INT/00001",
      kind: "Internal Transfer",
      status: "Done",
      partner: "Production Rack",
      scheduledDate: "2026-09-22",
      sourceLocationId: mainStock,
      destLocationId: productionRack,
      validatedAt: new Date("2026-09-22T11:20:00Z"),
    },
    [{ sku: "RAW-STEEL-001", demand: 30, received: 30 }],
  );
  await move({
    reference: "WH/INT/00001",
    operationId: steelTransfer,
    sku: "RAW-STEEL-001",
    from: mainStock,
    to: productionRack,
    quantity: 30,
    kind: "Internal Transfer",
    at: "2026-09-22T11:20:00Z",
  });

  const steelDelivery = await createOperation(
    {
      reference: "WH/OUT/00001",
      kind: "Delivery",
      status: "Done",
      partner: "Acme Manufacturing",
      scheduledDate: "2026-09-23",
      sourceDocument: "SO-120",
      sourceLocationId: productionRack,
      destLocationId: customers,
      validatedAt: new Date("2026-09-23T14:12:00Z"),
    },
    [{ sku: "RAW-STEEL-001", demand: 20, received: 20 }],
  );
  await move({
    reference: "WH/OUT/00001",
    operationId: steelDelivery,
    sku: "RAW-STEEL-001",
    from: productionRack,
    to: customers,
    quantity: 20,
    kind: "Delivery",
    at: "2026-09-23T14:12:00Z",
  });

  const steelAdjustment = await createOperation(
    {
      reference: "WH/ADJ/00001",
      kind: "Adjustment",
      status: "Done",
      partner: "Damaged in handling",
      scheduledDate: "2026-09-24",
      sourceLocationId: mainStock,
      destLocationId: loss,
      validatedAt: new Date("2026-09-24T16:45:00Z"),
    },
    [{ sku: "RAW-STEEL-001", demand: -3, received: -3 }],
  );
  await move({
    reference: "WH/ADJ/00001",
    operationId: steelAdjustment,
    sku: "RAW-STEEL-001",
    from: mainStock,
    to: loss,
    quantity: 3,
    kind: "Adjustment",
    at: "2026-09-24T16:45:00Z",
  });

  // Opening balances for everything else.
  const openingLines = Object.entries(OPENING).map(([sku, plan]) => ({
    sku,
    demand: plan.received,
    received: plan.received,
  }));
  const openingReceipt = await createOperation(
    {
      reference: "WH/IN/00002",
      kind: "Receipt",
      status: "Done",
      partner: "Opening stock count",
      scheduledDate: "2026-09-05",
      sourceDocument: "OPENING-2026",
      sourceLocationId: vendors,
      destLocationId: mainStock,
      validatedAt: new Date("2026-09-05T08:00:00Z"),
    },
    openingLines,
  );

  let minute = 10;
  for (const [sku, plan] of Object.entries(OPENING)) {
    const product = PRODUCTS.find((candidate) => candidate.sku === sku);
    if (!product || plan.received <= 0) continue;
    await move({
      reference: "WH/IN/00002",
      operationId: openingReceipt,
      sku,
      from: vendors,
      to: requireId(locationIds, product.location, "location"),
      quantity: plan.received,
      kind: "Receipt",
      at: `2026-09-05T08:${String(minute++).padStart(2, "0")}:00Z`,
    });
  }

  // One outbound batch that brings stock down to its current level.
  const outboundLines = Object.entries(OPENING)
    .filter(([, plan]) => plan.delivered > 0)
    .map(([sku, plan]) => ({ sku, demand: plan.delivered, received: plan.delivered }));

  if (outboundLines.length > 0) {
    const outbound = await createOperation(
      {
        reference: "WH/OUT/00002",
        kind: "Delivery",
        status: "Done",
        partner: "Cedar Industries",
        scheduledDate: "2026-09-16",
        sourceDocument: "SO-118",
        sourceLocationId: mainStock,
        destLocationId: customers,
        validatedAt: new Date("2026-09-16T15:00:00Z"),
      },
      outboundLines,
    );

    let outMinute = 10;
    for (const line of outboundLines) {
      const product = PRODUCTS.find((candidate) => candidate.sku === line.sku);
      if (!product) continue;
      await move({
        reference: "WH/OUT/00002",
        operationId: outbound,
        sku: line.sku,
        from: requireId(locationIds, product.location, "location"),
        to: customers,
        quantity: line.received,
        kind: "Delivery",
        at: `2026-09-16T15:${String(outMinute++).padStart(2, "0")}:00Z`,
      });
    }
  }

  result.completedDocuments = 6;

  for (const pending of PENDING) {
    await createOperation(
      {
        reference: pending.reference,
        kind: pending.kind,
        status: pending.status,
        partner: pending.partner,
        scheduledDate: pending.date,
        ...(pending.source ? { sourceDocument: pending.source } : {}),
        sourceLocationId: requireId(locationIds, pending.from, "location"),
        destLocationId: requireId(locationIds, pending.to, "location"),
      },
      pending.lines,
    );
    result.pendingDocuments += 1;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

/**
 * Removes all inventory data — products, documents, ledger, quants, locations,
 * warehouses and categories — in child-before-parent order.
 *
 * Deliberately leaves `users` and their reset codes alone: wiping accounts
 * would lock real people out of the app.
 */
export async function resetInventory(tx: Executor): Promise<void> {
  await tx.delete(stockMoves);
  await tx.delete(operationLines);
  await tx.delete(operations);
  await tx.delete(stockQuants);
  await tx.delete(reorderingRules);
  await tx.delete(products);
  await tx.delete(locations);
  await tx.delete(warehouses);
  await tx.delete(categories);
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

export type TableCounts = Record<string, number>;

export async function countRows(tx: Executor): Promise<TableCounts> {
  const tables = {
    users,
    categories,
    warehouses,
    locations,
    products,
    reorderingRules,
    operations,
    operationLines,
    stockMoves,
    stockQuants,
  };

  const counts: TableCounts = {};
  for (const [name, table] of Object.entries(tables)) {
    const [row] = await tx.select({ n: sql<number>`count(*)::int` }).from(table);
    counts[name] = row?.n ?? 0;
  }
  return counts;
}

export type IntegrityIssue = {
  sku: string;
  name: string;
  quants: number;
  ledger: number;
};

/**
 * The invariant this whole system rests on: for every product, the sum of the
 * ledger must equal the sum of on-hand quantities. Any row returned here means
 * stock was written outside the engine.
 */
export async function checkIntegrity(
  tx: Executor,
): Promise<{ checked: number; issues: IntegrityIssue[] }> {
  const rows = await tx
    .select({
      sku: products.sku,
      name: products.name,
      quants: sql<number>`coalesce((select sum(quantity) from stock_quants where product_id = ${products.id}), 0)::float`,
      ledger: sql<number>`coalesce((select sum(quantity) from stock_moves where product_id = ${products.id}), 0)::float`,
    })
    .from(products);

  const issues = rows
    .filter((row) => Number(row.quants) !== Number(row.ledger))
    .map((row) => ({
      sku: row.sku,
      name: row.name,
      quants: Number(row.quants),
      ledger: Number(row.ledger),
    }));

  return { checked: rows.length, issues };
}

/** Locations without which no operation can be recorded. */
export async function missingVirtualLocations(tx: Executor): Promise<string[]> {
  const required = VIRTUAL_LOCATIONS.map((location) => location.fullName);
  const rows = await tx.select({ fullName: locations.fullName }).from(locations);
  const present = new Set(rows.map((row) => row.fullName));
  return required.filter((name) => !present.has(name));
}

/** Orphaned reset codes, a cheap signal that cleanup is working. */
export async function pendingOtpCount(tx: Executor): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(passwordResetOtps)
    .where(and(isNull(passwordResetOtps.consumedAt)));
  return row?.n ?? 0;
}
