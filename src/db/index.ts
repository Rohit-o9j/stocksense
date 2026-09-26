/**
 * Server-only Neon database client.
 *
 * IMPORTANT: never import this from component code that runs in the browser.
 * Reach it from TanStack Start server functions (`createServerFn`) or route
 * loaders only. `DATABASE_URL` is deliberately not `VITE_`-prefixed, so Vite
 * does not inject it into the client bundle — keep it that way.
 *
 * Uses the WebSocket-backed `Pool` driver rather than Neon's HTTP driver
 * because validating a stock operation has to write moves and update quants
 * atomically, and `drizzle-orm/neon-http` has no transaction support at all.
 */
import { Pool } from "@neondatabase/serverless";
import { drizzle, type NeonDatabase } from "drizzle-orm/neon-serverless";

import * as schema from "./schema";

if (typeof window !== "undefined") {
  throw new Error(
    "src/db was imported in the browser. Database access belongs in a server function " +
      "(createServerFn) or a route loader, never in client components.",
  );
}

const connectionString = process.env["DATABASE_URL"];

if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env and paste your Neon connection string.",
  );
}

/** Exported so standalone scripts (the seed) can close it and let the process exit. */
export const pool = new Pool({ connectionString });

export const db = drizzle({ client: pool, schema });

/** The typed database handle, for annotating helpers that accept `db` or a transaction. */
export type Database = NeonDatabase<typeof schema>;

/**
 * Either the root client or an open transaction. Helpers that must be callable
 * both standalone and inside `db.transaction()` take this.
 */
export type Executor = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

export { schema };
