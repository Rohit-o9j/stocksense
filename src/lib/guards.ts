/**
 * Server-side authorization. Server-only.
 *
 * Server functions are ordinary HTTP endpoints — disabling a button in the UI
 * stops nobody from calling them directly. Every handler that reads or writes
 * inventory must go through one of these guards.
 *
 *   requireUser()    any signed-in user — reads and day-to-day operations
 *   requireManager() Inventory Manager only — master data and configuration
 */
import { eq } from "drizzle-orm";
// Aliased: this is TanStack Start's server-side session accessor, not a React
// hook. Importing it under its own name trips the react-hooks lint rule.
import { useSession as readSession } from "@tanstack/react-start/server";

import { db } from "../db";
import { users } from "../db/schema";
import { sessionConfig, type SessionPayload } from "./session";

export type Role = "Warehouse Staff" | "Inventory Manager" | "Admin";

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  lowStockAlerts: boolean;
};

/** Higher wins. Used so Admin inherits every Inventory Manager permission. */
const RANK: Record<Role, number> = {
  "Warehouse Staff": 1,
  "Inventory Manager": 2,
  Admin: 3,
};

export function atLeast(role: Role, minimum: Role): boolean {
  return RANK[role] >= RANK[minimum];
}

/** Loads a user by id, or null when the row has gone. */
export async function loadUser(userId: string): Promise<SessionUser | null> {
  const [row] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      lowStockAlerts: users.lowStockAlerts,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return row ?? null;
}

/**
 * The signed-in user, or null. Role is read from the database rather than the
 * cookie, so a demotion takes effect on the next request.
 */
export async function currentUser(): Promise<SessionUser | null> {
  const session = await readSession<SessionPayload>(sessionConfig);
  const userId = session.data.userId;
  if (!userId) return null;

  const user = await loadUser(userId);
  // The account was removed while the cookie was still valid.
  if (!user) await session.clear();
  return user;
}

export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) throw new Error("You need to sign in to do that.");
  return user;
}

/** Inventory Manager or above. */
export async function requireManager(): Promise<SessionUser> {
  const user = await requireUser();
  if (!atLeast(user.role, "Inventory Manager")) {
    throw new Error("Inventory Manager access is required for this action.");
  }
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (!atLeast(user.role, "Admin")) {
    throw new Error("Admin access is required for this action.");
  }
  return user;
}
