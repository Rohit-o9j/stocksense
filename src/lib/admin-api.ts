/**
 * Admin server functions.
 *
 * Every handler is behind `requireAdmin`. The demo-data actions call the same
 * routines the seed CLI uses, so what an admin loads from the browser is
 * identical to what `bun run db:seed` produces.
 */
import { createServerFn } from "@tanstack/react-start";
import { asc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "../db";
import {
  checkIntegrity,
  countRows,
  missingVirtualLocations,
  pendingOtpCount,
  resetInventory as resetInventoryRows,
  seedBaseline,
  seedDemo,
  type IntegrityIssue,
} from "../db/demo-data";
import { users } from "../db/schema";
import { requireAdmin, type Role } from "./guards";

export type AdminUserRow = {
  id: string;
  name: string;
  email: string;
  role: Role;
  createdAt: string;
  lowStockAlerts: boolean;
};

export type AdminOverview = {
  counts: Record<string, number>;
  roles: Record<string, number>;
  integrity: { checked: number; issues: IntegrityIssue[] };
  /** Empty means stock operations are possible. */
  missingVirtualLocations: string[];
  pendingResetCodes: number;
  users: AdminUserRow[];
  environment: {
    nodeEnv: string;
    /** True when password reset codes are handed back to the browser. */
    otpExposed: boolean;
    sessionCookie: string;
    databaseHost: string;
  };
};

const ROLES = ["Warehouse Staff", "Inventory Manager", "Admin"] as const;

/** Host only — never the credentials in the connection string. */
function databaseHost(): string {
  const url = process.env["DATABASE_URL"];
  if (!url) return "not configured";
  try {
    return new URL(url).host;
  } catch {
    return "unparseable";
  }
}

export const getAdminOverview = createServerFn({ method: "GET" }).handler(
  async (): Promise<AdminOverview> => {
    await requireAdmin();

    const counts = await countRows(db);
    const integrity = await checkIntegrity(db);
    const missing = await missingVirtualLocations(db);
    const pendingResetCodes = await pendingOtpCount(db);

    const roleRows = await db
      .select({ role: users.role, n: sql<number>`count(*)::int` })
      .from(users)
      .groupBy(users.role);

    const userRows = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        createdAt: users.createdAt,
        lowStockAlerts: users.lowStockAlerts,
      })
      .from(users)
      .orderBy(asc(users.createdAt));

    const nodeEnv = process.env["NODE_ENV"] ?? "development";

    return {
      counts,
      roles: Object.fromEntries(roleRows.map((row) => [row.role, row.n])),
      integrity,
      missingVirtualLocations: missing,
      pendingResetCodes,
      users: userRows.map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        role: row.role,
        createdAt: row.createdAt.toISOString().slice(0, 10),
        lowStockAlerts: row.lowStockAlerts,
      })),
      environment: {
        nodeEnv,
        otpExposed: nodeEnv !== "production",
        sessionCookie: "stocksense_session",
        databaseHost: databaseHost(),
      },
    };
  },
);

// ---------------------------------------------------------------------------
// Demo data
// ---------------------------------------------------------------------------

export const seedReferenceData = createServerFn({ method: "POST" }).handler(
  async (): Promise<string> => {
    await requireAdmin();
    const result = await db.transaction((tx) => seedBaseline(tx));
    const added =
      result.categories + result.warehouses + result.locations + result.users === 0
        ? "Reference data was already complete."
        : `Added ${result.categories} categories, ${result.warehouses} warehouses, ` +
          `${result.locations} locations and ${result.users} demo logins.`;
    return added;
  },
);

export const seedDemoInventory = createServerFn({ method: "POST" }).handler(
  async (): Promise<string> => {
    await requireAdmin();
    const result = await db.transaction(async (tx) => {
      // Reference data is a prerequisite; make it present rather than failing.
      await seedBaseline(tx);
      return seedDemo(tx);
    });
    return (
      `Loaded ${result.products} products, ${result.completedDocuments} completed and ` +
      `${result.pendingDocuments} in-flight documents, ${result.moves} ledger entries.`
    );
  },
);

const confirmInput = z.object({
  /** Must be the literal word, typed by the admin, to avoid an accidental wipe. */
  confirmation: z.string(),
});

export const resetInventory = createServerFn({ method: "POST" })
  .validator((input: unknown) => confirmInput.parse(input))
  .handler(async ({ data }): Promise<string> => {
    await requireAdmin();

    if (data.confirmation !== "RESET") {
      throw new Error("Type RESET to confirm.");
    }

    await db.transaction((tx) => resetInventoryRows(tx));
    return "Inventory cleared. User accounts were left untouched.";
  });

// ---------------------------------------------------------------------------
// User management
// ---------------------------------------------------------------------------

const roleInput = z.object({
  userId: z.string().min(1),
  role: z.enum(ROLES),
});

export const setUserRole = createServerFn({ method: "POST" })
  .validator((input: unknown) => roleInput.parse(input))
  .handler(async ({ data }): Promise<void> => {
    const actor = await requireAdmin();

    // Changing your own role is how an admin accidentally locks themselves out.
    if (data.userId === actor.id) {
      throw new Error("You cannot change your own role. Ask another admin.");
    }

    const [target] = await db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.id, data.userId))
      .limit(1);

    if (!target) throw new Error("That account no longer exists.");
    if (target.role === data.role) return;

    // Demoting the last admin would leave nobody able to administer the system.
    if (target.role === "Admin" && data.role !== "Admin") {
      const [remaining] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(users)
        .where(eq(users.role, "Admin"));
      if ((remaining?.n ?? 0) <= 1) {
        throw new Error("This is the only Admin. Promote someone else first.");
      }
    }

    await db.update(users).set({ role: data.role }).where(eq(users.id, data.userId));
  });

const deleteInput = z.object({ userId: z.string().min(1) });

export const deleteUser = createServerFn({ method: "POST" })
  .validator((input: unknown) => deleteInput.parse(input))
  .handler(async ({ data }): Promise<void> => {
    const actor = await requireAdmin();

    if (data.userId === actor.id) {
      throw new Error("You cannot delete your own account.");
    }

    const [target] = await db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.id, data.userId))
      .limit(1);

    if (!target) return;

    if (target.role === "Admin") {
      const [remaining] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(users)
        .where(ne(users.id, target.id));
      // Keep at least one other account around.
      if ((remaining?.n ?? 0) === 0) {
        throw new Error("You cannot delete the last account.");
      }
    }

    // Documents reference the user with ON DELETE SET NULL, so history survives.
    await db.delete(users).where(eq(users.id, data.userId));
  });
