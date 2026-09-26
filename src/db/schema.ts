/**
 * StockSense database schema (Neon Postgres via Drizzle).
 *
 * Mirrors the domain in `src/lib/stock.tsx`, normalized for persistence:
 *
 *   prototype                          -> schema
 *   ------------------------------------------------------------------------
 *   Product.onHand (single number)      -> stockQuants rows per (product, location)
 *   Product.location (string)           -> locations.fullName, referenced by id
 *   Product.minimum / .maximum          -> reorderingRules per (product, warehouse)
 *   Product.category (string)           -> categories.name, referenced by id
 *   Operation.id ('WH/IN/00001')        -> operations.reference (uuid is the PK)
 *   Operation.partner (string)          -> operations.partner
 *
 * Enum values are kept byte-identical to the TypeScript unions in stock.tsx so
 * no mapping layer is needed between the database and the existing UI types.
 */
import {
  boolean,
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

/**
 * Quantities are exact decimals, never floats — inventory arithmetic must not
 * drift. `mode: 'number'` keeps them as plain numbers in TypeScript while
 * Postgres stores them as NUMERIC(14,3), enough for fractional kg / L / m.
 */
const quantity = (name: string) => numeric(name, { precision: 14, scale: 3, mode: 'number' });

// ---------------------------------------------------------------------------
// Enums — values match the unions in src/lib/stock.tsx exactly
// ---------------------------------------------------------------------------

/** Shared document workflow: Draft -> Waiting -> Ready -> Done, Canceled from any state. */
export const statusEnum = pgEnum('status', ['Draft', 'Waiting', 'Ready', 'Done', 'Canceled']);

/** The four operation types, all of which are moves between two locations. */
export const kindEnum = pgEnum('operation_kind', [
  'Receipt',
  'Delivery',
  'Internal Transfer',
  'Adjustment',
]);

/**
 * Access levels, least to most privileged. Admin inherits everything an
 * Inventory Manager can do, plus user management and demo data control.
 */
export const roleEnum = pgEnum('user_role', ['Warehouse Staff', 'Inventory Manager', 'Admin']);

/**
 * Internal locations hold real stock. Vendor / Customer / Inventory Loss are
 * virtual: they are the counterparty of a move, so receipts, deliveries and
 * adjustments all reduce to the same source -> destination shape.
 */
export const locationKindEnum = pgEnum('location_kind', [
  'Internal',
  'Vendor',
  'Customer',
  'Inventory Loss',
]);

/** Reason recorded against an inventory adjustment line. */
export const adjustmentReasonEnum = pgEnum('adjustment_reason', [
  'Damaged',
  'Lost',
  'Found',
  'Miscount',
  'Other',
]);

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    /** bcrypt/argon2 digest — never a plaintext password. */
    passwordHash: text('password_hash').notNull(),
    role: roleEnum('role').notNull().default('Warehouse Staff'),
    lowStockAlerts: boolean('low_stock_alerts').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('users_email_key').on(table.email)],
);

/**
 * OTP codes for password reset. The code itself is hashed at rest, expires
 * quickly, and carries an attempt counter so it cannot be brute forced.
 */
export const passwordResetOtps = pgTable(
  'password_reset_otps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('password_reset_otps_user_idx').on(table.userId, table.expiresAt)],
);

// ---------------------------------------------------------------------------
// Master data
// ---------------------------------------------------------------------------

export const categories = pgTable(
  'categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
  },
  (table) => [uniqueIndex('categories_name_key').on(table.name)],
);

export const warehouses = pgTable(
  'warehouses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    /** Short prefix used in document references, e.g. 'WH' in WH/IN/00001. */
    code: text('code').notNull(),
    address: text('address'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('warehouses_code_key').on(table.code)],
);

export const locations = pgTable(
  'locations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Null for virtual locations, which belong to no warehouse. */
    warehouseId: uuid('warehouse_id').references(() => warehouses.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Display path such as 'Main / Stock' — matches the prototype's strings. */
    fullName: text('full_name').notNull(),
    kind: locationKindEnum('kind').notNull().default('Internal'),
    parentId: uuid('parent_id').references((): AnyPgColumn => locations.id, {
      onDelete: 'set null',
    }),
    active: boolean('active').notNull().default(true),
  },
  (table) => [
    uniqueIndex('locations_full_name_key').on(table.fullName),
    index('locations_warehouse_idx').on(table.warehouseId),
  ],
);

export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    sku: text('sku').notNull(),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
    /** Unit of measure: kg, units, sheets, L, m, rolls, pairs, boxes. */
    unit: text('unit').notNull().default('units'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('products_sku_key').on(table.sku),
    index('products_category_idx').on(table.categoryId),
    index('products_name_idx').on(table.name),
  ],
);

/** Min/max levels driving low-stock alerts and suggested reorder quantities. */
export const reorderingRules = pgTable(
  'reordering_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id, { onDelete: 'cascade' }),
    minQty: quantity('min_qty').notNull().default(0),
    maxQty: quantity('max_qty').notNull().default(0),
  },
  (table) => [uniqueIndex('reordering_rules_product_warehouse_key').on(table.productId, table.warehouseId)],
);

// ---------------------------------------------------------------------------
// Stock state
// ---------------------------------------------------------------------------

/**
 * On-hand quantity per (product, location) — the materialized result of all
 * done moves. Written only inside the same transaction that marks an operation
 * Done, so quantities can never disagree with the ledger.
 */
export const stockQuants = pgTable(
  'stock_quants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'cascade' }),
    quantity: quantity('quantity').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('stock_quants_product_location_key').on(table.productId, table.locationId),
    index('stock_quants_product_idx').on(table.productId),
    index('stock_quants_location_idx').on(table.locationId),
  ],
);

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

/**
 * One table for receipts, deliveries, internal transfers and adjustments.
 * `kind` distinguishes them; the source/destination locations carry the
 * semantics (vendor -> stock, stock -> customer, stock -> stock, loss <-> stock).
 */
export const operations = pgTable(
  'operations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Human reference: WH/IN/00001, WH/OUT/00001, WH/INT/00001, WH/ADJ/00001. */
    reference: text('reference').notNull(),
    kind: kindEnum('kind').notNull(),
    status: statusEnum('status').notNull().default('Draft'),
    /** Supplier, customer, destination rack, or adjustment reason. */
    partner: text('partner'),
    scheduledDate: date('scheduled_date'),
    sourceLocationId: uuid('source_location_id').references(() => locations.id, {
      onDelete: 'restrict',
    }),
    destLocationId: uuid('dest_location_id').references(() => locations.id, {
      onDelete: 'restrict',
    }),
    /** Originating document, e.g. PO-2026-111 or SO-120. */
    sourceDocument: text('source_document'),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    validatedAt: timestamp('validated_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('operations_reference_key').on(table.reference),
    index('operations_kind_status_idx').on(table.kind, table.status),
    index('operations_scheduled_date_idx').on(table.scheduledDate),
  ],
);

export const operationLines = pgTable(
  'operation_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    operationId: uuid('operation_id')
      .notNull()
      .references(() => operations.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    /** Expected quantity on the document. */
    demandQty: quantity('demand_qty').notNull().default(0),
    /** Actually received / picked / counted quantity. */
    receivedQty: quantity('received_qty').notNull().default(0),
    picked: boolean('picked').notNull().default(false),
    /** Only set on adjustment lines. */
    reason: adjustmentReasonEnum('reason'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => [index('operation_lines_operation_idx').on(table.operationId)],
);

/**
 * The stock ledger. Every validated line writes one row here, and Move History
 * reads these same rows — so the ledger cannot drift from actual quantities.
 * `quantity` is signed relative to the company: +in, -out, 0 for internal moves.
 */
export const stockMoves = pgTable(
  'stock_moves',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    operationId: uuid('operation_id').references(() => operations.id, { onDelete: 'set null' }),
    /** Denormalized operation reference so the ledger reads without a join. */
    reference: text('reference').notNull(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    fromLocationId: uuid('from_location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'restrict' }),
    toLocationId: uuid('to_location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'restrict' }),
    quantity: quantity('quantity').notNull(),
    kind: kindEnum('kind').notNull(),
    status: statusEnum('status').notNull().default('Done'),
    doneById: uuid('done_by_id').references(() => users.id, { onDelete: 'set null' }),
    doneAt: timestamp('done_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('stock_moves_product_idx').on(table.productId),
    index('stock_moves_done_at_idx').on(table.doneAt),
    index('stock_moves_reference_idx').on(table.reference),
    index('stock_moves_kind_status_idx').on(table.kind, table.status),
  ],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const usersRelations = relations(users, ({ many }) => ({
  operations: many(operations),
  moves: many(stockMoves),
  otps: many(passwordResetOtps),
}));

export const passwordResetOtpsRelations = relations(passwordResetOtps, ({ one }) => ({
  user: one(users, { fields: [passwordResetOtps.userId], references: [users.id] }),
}));

export const categoriesRelations = relations(categories, ({ many }) => ({
  products: many(products),
}));

export const warehousesRelations = relations(warehouses, ({ many }) => ({
  locations: many(locations),
  reorderingRules: many(reorderingRules),
}));

export const locationsRelations = relations(locations, ({ one, many }) => ({
  warehouse: one(warehouses, { fields: [locations.warehouseId], references: [warehouses.id] }),
  parent: one(locations, { fields: [locations.parentId], references: [locations.id] }),
  quants: many(stockQuants),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  category: one(categories, { fields: [products.categoryId], references: [categories.id] }),
  quants: many(stockQuants),
  lines: many(operationLines),
  moves: many(stockMoves),
  reorderingRules: many(reorderingRules),
}));

export const reorderingRulesRelations = relations(reorderingRules, ({ one }) => ({
  product: one(products, { fields: [reorderingRules.productId], references: [products.id] }),
  warehouse: one(warehouses, {
    fields: [reorderingRules.warehouseId],
    references: [warehouses.id],
  }),
}));

export const stockQuantsRelations = relations(stockQuants, ({ one }) => ({
  product: one(products, { fields: [stockQuants.productId], references: [products.id] }),
  location: one(locations, { fields: [stockQuants.locationId], references: [locations.id] }),
}));

export const operationsRelations = relations(operations, ({ one, many }) => ({
  lines: many(operationLines),
  moves: many(stockMoves),
  sourceLocation: one(locations, {
    fields: [operations.sourceLocationId],
    references: [locations.id],
    relationName: 'operationSourceLocation',
  }),
  destLocation: one(locations, {
    fields: [operations.destLocationId],
    references: [locations.id],
    relationName: 'operationDestLocation',
  }),
  createdBy: one(users, { fields: [operations.createdById], references: [users.id] }),
}));

export const operationLinesRelations = relations(operationLines, ({ one }) => ({
  operation: one(operations, {
    fields: [operationLines.operationId],
    references: [operations.id],
  }),
  product: one(products, { fields: [operationLines.productId], references: [products.id] }),
}));

export const stockMovesRelations = relations(stockMoves, ({ one }) => ({
  operation: one(operations, { fields: [stockMoves.operationId], references: [operations.id] }),
  product: one(products, { fields: [stockMoves.productId], references: [products.id] }),
  fromLocation: one(locations, {
    fields: [stockMoves.fromLocationId],
    references: [locations.id],
    relationName: 'moveFromLocation',
  }),
  toLocation: one(locations, {
    fields: [stockMoves.toLocationId],
    references: [locations.id],
    relationName: 'moveToLocation',
  }),
  doneBy: one(users, { fields: [stockMoves.doneById], references: [users.id] }),
}));

// ---------------------------------------------------------------------------
// Inferred row types — suffixed `Row` to stay distinct from the UI types
// exported by src/lib/stock.tsx.
// ---------------------------------------------------------------------------

export type UserRow = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type CategoryRow = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
export type WarehouseRow = typeof warehouses.$inferSelect;
export type NewWarehouse = typeof warehouses.$inferInsert;
export type LocationRow = typeof locations.$inferSelect;
export type NewLocation = typeof locations.$inferInsert;
export type ProductRow = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type ReorderingRuleRow = typeof reorderingRules.$inferSelect;
export type NewReorderingRule = typeof reorderingRules.$inferInsert;
export type StockQuantRow = typeof stockQuants.$inferSelect;
export type NewStockQuant = typeof stockQuants.$inferInsert;
export type OperationRow = typeof operations.$inferSelect;
export type NewOperation = typeof operations.$inferInsert;
export type OperationLineRow = typeof operationLines.$inferSelect;
export type NewOperationLine = typeof operationLines.$inferInsert;
export type StockMoveRow = typeof stockMoves.$inferSelect;
export type NewStockMove = typeof stockMoves.$inferInsert;
