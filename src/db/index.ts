/**
 * Server-only Neon database client.
 *
 * IMPORTANT: never import this from component code that runs in the browser.
 * Reach it from TanStack Start server functions (`createServerFn`) or route
 * loaders only. `DATABASE_URL` is deliberately not `VITE_`-prefixed, so Vite
 * does not inject it into the client bundle — keep it that way.
 */
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';

import * as schema from './schema';

if (typeof window !== 'undefined') {
  throw new Error(
    'src/db was imported in the browser. Database access belongs in a server function ' +
      '(createServerFn) or a route loader, never in client components.',
  );
}

const connectionString = process.env['DATABASE_URL'];

if (!connectionString) {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example to .env and paste your Neon connection string.',
  );
}

/**
 * Neon's HTTP driver: one round trip per query, no connection pool to manage,
 * and it works on the Cloudflare Workers target this project builds for.
 */
export const db = drizzle({ client: neon(connectionString), schema });

export { schema };
