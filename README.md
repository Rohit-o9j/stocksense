# StockSense

A modular Inventory Management System that digitizes stock operations end to end — replacing manual registers, spreadsheets, and scattered tracking with one centralized, real-time source of truth.

Built as a single full-stack TanStack Start application backed by Neon Postgres. Every quantity change passes through one transactional stock engine, so the movement ledger and on-hand quantities cannot disagree.

---

## Table of contents

- [The problem](#the-problem)
- [Roles and permissions](#roles-and-permissions)
- [Core concept: everything is a move](#core-concept-everything-is-a-move)
- [Worked example](#worked-example)
- [Architecture](#architecture)
- [Data model](#data-model)
- [The stock engine](#the-stock-engine)
- [Authentication and sessions](#authentication-and-sessions)
- [Authorization](#authorization)
- [Feature reference](#feature-reference)
- [Admin dashboard](#admin-dashboard)
- [Tech stack](#tech-stack)
- [Project structure](#project-structure)
- [Getting started](#getting-started)
- [Scripts](#scripts)
- [Environment variables](#environment-variables)
- [Database migrations](#database-migrations)
- [Demonstration data](#demonstration-data)
- [Conventions for contributors](#conventions-for-contributors)
- [Known limitations](#known-limitations)

---

## The problem

Warehouse teams track stock across paper registers, Excel files, and individual memory. Counts drift from reality, low stock goes unnoticed until it stops production, and nobody can answer "where is this item right now" without walking the floor.

StockSense addresses that with three things:

1. **A single ledger.** Every movement of stock is one row. Nothing changes a quantity without writing one.
2. **On-hand broken down per location**, not just a single company-wide number per product.
3. **Reorder rules** that surface a shortage before it stops work.

---

## Roles and permissions

Three levels, ranked. Each inherits everything below it.

| Role | Can do | Cannot do |
|---|---|---|
| **Warehouse Staff** | Read all inventory, create receipts, edit draft documents, validate operations, run counting sheets | Create or edit products, categories, reorder rules, warehouses, locations |
| **Inventory Manager** | Everything above, plus all master data and warehouse configuration | Manage users, load or reset demonstration data |
| **Admin** | Everything above, plus user management, role changes, demo data control, system health | — |

Ranking is implemented numerically in `src/lib/guards.ts` rather than by equality checks, so `requireManager()` naturally accepts an Admin:

```ts
const RANK = { 'Warehouse Staff': 1, 'Inventory Manager': 2, Admin: 3 };
export function atLeast(role: Role, minimum: Role) { return RANK[role] >= RANK[minimum]; }
```

**Role assignment is server-side only.** The sign-up form does not send a role, and the server would ignore it if it did. The first account ever created becomes Admin so a fresh install is administrable; every account after it starts as Warehouse Staff and must be promoted from the admin dashboard.

---

## Core concept: everything is a move

Receipts, delivery orders, internal transfers, and stock adjustments look like four separate features. They are not. Each one is a **stock move from a source location to a destination location**, where vendors, customers, and inventory-loss are modelled as *virtual* locations that hold no tracked stock.

```mermaid
flowchart LR
    V(["Vendors<br/><i>virtual</i>"]):::virt
    C(["Customers<br/><i>virtual</i>"]):::virt
    L(["Inventory Loss<br/><i>virtual</i>"]):::virt

    subgraph WH1["Main Warehouse"]
        S1["Stock"]:::real
        R1["Production Rack"]:::real
    end

    subgraph WH2["East Warehouse"]
        S2["Stock"]:::real
    end

    V -- "Receipt +100" --> S1
    S1 -- "Transfer 0" --> R1
    S1 -- "Transfer 0" --> S2
    R1 -- "Delivery -20" --> C
    R1 -- "Adjustment -3" --> L
    L -- "Adjustment +n" --> S1

    classDef virt fill:#f4f4f5,stroke:#a1a1aa,stroke-dasharray:4 3,color:#3f3f46
    classDef real fill:#ecfdf5,stroke:#10b981,color:#064e3b
```

| Operation | From | To | Ledger sign | Net stock |
|---|---|---|---|---|
| Receipt | Vendors *(virtual)* | internal location | `+qty` | increases |
| Delivery Order | internal location | Customers *(virtual)* | `−qty` | decreases |
| Internal Transfer | internal location | internal location | `0` | unchanged, location moves |
| Adjustment | Inventory Loss ↔ internal | `±qty` | either | increases or decreases |

The sign is **derived from the location kinds**, never passed in by a caller:

```
from virtual → to internal   =  +quantity
from internal → to virtual   =  −quantity
from internal → to internal  =   0
```

Four consequences fall out of this design:

- **Move History is a query, not a log.** It reads the same rows that moved the stock, so it cannot drift out of sync with reality.
- **On-hand per location** is maintained as one `stock_quants` row per `(product, location)`, written only by the engine.
- **One status workflow** covers all four document types: `Draft → Waiting → Ready → Done`, with `Canceled` reachable from any state.
- **One validation path.** `validateOperation` handles every kind, including the availability check that prevents negative stock.

---

## Worked example

The reference scenario, seeded by the demo dataset and used as the system's integrity test:

```
Receive  100 kg Steel Rods from vendor       → Main / Stock      100
Transfer  30 kg Main/Stock → Production Rack → Main / Stock       70   Production Rack 30
Deliver   20 kg from Production Rack         → Production Rack   10
Adjust     3 kg damaged, written off         → Main / Stock       67
```

Final state: **77 kg on hand**, split 67 at Main / Stock and 10 at Production Rack, with **exactly four ledger entries**. Total stock never changed during the transfer — only its location did.

The admin dashboard verifies this invariant continuously across every product: the sum of a product's ledger must equal the sum of its on-hand rows. Any mismatch means stock was written outside the engine.

---

## Architecture

StockSense is **one application**, not a client plus a separate API.

```
Browser                        Server (same deployment)
─────────────────────────      ────────────────────────────────────────
React components          ──▶  server functions (createServerFn)
src/components/*               src/lib/stock-api.ts
                               src/lib/auth-api.ts
src/lib/stock.tsx              src/lib/admin-api.ts
  TanStack Query cache               │
src/lib/auth.tsx                     ▼
  session-backed user          guards.ts  →  requireUser / requireManager / requireAdmin
                                     │
                                     ▼
                               stock-engine.ts  (the only writer of quantities)
                                     │
                                     ▼
                               Drizzle ORM → Neon Postgres
```

**Server functions** are TanStack Start's RPC mechanism. The handler body is stripped from the client bundle and replaced with a fetch call, so database code never reaches the browser. `DATABASE_URL` is deliberately not `VITE_`-prefixed, which means Vite cannot inline it into client output.

Two boundaries are enforced by the framework and worth knowing:

- Anything under `src/server/**` is **denied** in the client environment by TanStack Start's import protection. This is why the server functions live in `src/lib/*-api.ts` rather than `src/server/`.
- `src/db/index.ts` throws immediately if it is ever evaluated in a browser, as a second line of defence.

**Client state** is deliberately thin. `src/lib/stock.tsx` exposes the same shape the page components always consumed, but it is a TanStack Query cache over `getSnapshot()` plus a small amount of edit state — not a source of data.

---

## Data model

Eleven tables. Quantities are `NUMERIC(14,3)` throughout — exact decimals, never floats, because inventory arithmetic must not drift. Drizzle maps them to plain `number` via `mode: 'number'`.

```mermaid
erDiagram
    users ||--o{ operations : "created_by"
    users ||--o{ stock_moves : "done_by"
    users ||--o{ password_reset_otps : ""
    categories ||--o{ products : ""
    warehouses ||--o{ locations : ""
    warehouses ||--o{ reordering_rules : ""
    locations ||--o{ locations : "parent"
    locations ||--o{ stock_quants : ""
    products ||--o{ stock_quants : ""
    products ||--o{ reordering_rules : ""
    products ||--o{ operation_lines : ""
    products ||--o{ stock_moves : ""
    operations ||--o{ operation_lines : ""
    operations ||--o{ stock_moves : ""
```

| Table | Purpose | Notes |
|---|---|---|
| `users` | Accounts | Unique email, PBKDF2 hash, role enum, low-stock preference |
| `password_reset_otps` | One-time reset codes | Hashed at rest, expiry, attempt counter |
| `categories` | Product groups | Unique name |
| `warehouses` | Physical sites | Unique short code used in document references |
| `locations` | Storage and counterparties | `kind` = Internal / Vendor / Customer / Inventory Loss; self-referencing `parent_id`; unique `full_name` such as `Main / Stock` |
| `products` | Catalog | Unique SKU, unit of measure, soft-delete via `active` |
| `reordering_rules` | Min/max levels | Unique per `(product, warehouse)`; drives low-stock alerts |
| `stock_quants` | **On-hand per location** | Unique per `(product, location)`; only the engine writes it |
| `operations` | All four document types | `kind` + `status`; unique human `reference` like `WH/IN/00001` |
| `operation_lines` | Document lines | Demand vs received quantity, picked flag, adjustment reason |
| `stock_moves` | **The ledger** | Signed quantity, from/to location, who and when |

### Enums

| Enum | Values |
|---|---|
| `user_role` | `Warehouse Staff`, `Inventory Manager`, `Admin` |
| `status` | `Draft`, `Waiting`, `Ready`, `Done`, `Canceled` |
| `operation_kind` | `Receipt`, `Delivery`, `Internal Transfer`, `Adjustment` |
| `location_kind` | `Internal`, `Vendor`, `Customer`, `Inventory Loss` |
| `adjustment_reason` | `Damaged`, `Lost`, `Found`, `Miscount`, `Other` |

Enum values are byte-identical to the TypeScript union types the UI consumes, so no mapping layer is needed between database and interface.

### Reference numbering

Documents carry a human reference alongside their UUID primary key:

| Kind | Prefix | Example |
|---|---|---|
| Receipt | `WH/IN` | `WH/IN/00001` |
| Delivery | `WH/OUT` | `WH/OUT/00001` |
| Internal Transfer | `WH/INT` | `WH/INT/00001` |
| Adjustment | `WH/ADJ` | `WH/ADJ/00001` |

---

## The stock engine

`src/db/stock-engine.ts` is the only module permitted to change on-hand quantities. Everything else calls `applyMove`.

```ts
await db.transaction(async (tx) => {
  await applyMove(tx, {
    reference, operationId, productId,
    fromLocationId, toLocationId,
    quantity,            // always positive; direction comes from the locations
    kind, doneById, doneAt,
  });
  await tx.update(operations).set({ status: 'Done', validatedAt: now })...;
});
```

Guarantees it provides:

- **Atomicity.** Callers wrap it in `db.transaction()`, so a rejected line leaves the document completely untouched rather than half applied.
- **No lost updates.** Quant changes use `onConflictDoUpdate` with a SQL-side increment (`quantity = quantity + delta`), not read-modify-write, so concurrent moves cannot overwrite each other.
- **Ledger and quants written together.** One call does both; they cannot diverge.
- **Positive quantities only.** Passing a negative throws. Direction is the locations' job.
- **Virtual locations hold nothing.** Quants are tracked for `Internal` locations only.

One important driver note: the project uses **`drizzle-orm/neon-serverless`** (WebSocket `Pool`), not `neon-http`. The HTTP driver has no transaction support at all, which the engine requires.

Queries inside `applyMove` run **sequentially on purpose** — a single Postgres connection cannot service concurrent statements, so `Promise.all` inside a transaction would break it.

---

## Authentication and sessions

| Concern | Implementation |
|---|---|
| Password hashing | PBKDF2-SHA256, 210,000 iterations, 16-byte salt, via WebCrypto |
| Hash format | `pbkdf2$<iterations>$<salt b64>$<key b64>` — self-describing, so iterations can be raised later without invalidating existing hashes |
| Session | Encrypted, signed, `httpOnly` cookie via TanStack Start's session helpers |
| Cookie contents | **User id only** |
| Session lifetime | 14 days, `sameSite=lax`, `secure` in production |
| Password reset | Six-digit OTP, hashed at rest, 10-minute expiry, 5-attempt cap, all outstanding codes burned on use |

WebCrypto rather than bcrypt or argon2 because the same code has to run in Node, Bun, and the Cloudflare Workers runtime this project builds for — native addons do not.

Only the user id goes in the cookie. Name and role are read from the database on **every** request, so demoting or deleting someone takes effect immediately rather than whenever their cookie happens to expire.

Two deliberate anti-enumeration measures: a failed sign-in spends comparable time hashing so response timing does not reveal whether an address exists, and a reset request reports success for unknown addresses.

---

## Authorization

Every server function begins with a guard. There are no unguarded endpoints except the ones that must be public.

| Guard | Applies to |
|---|---|
| *(public)* | `signIn`, `signUp`, `signOut`, `requestPasswordOtp`, `resetPasswordWithOtp`, `getCurrentUser` |
| `requireUser()` | `getSnapshot`, `createReceipt`, `updateOperation`, `validateOperation`, `applyAdjustment`, `updateProfile`, `changePassword` |
| `requireManager()` | `createProduct`, `createCategory`, `saveReorderingRule`, `createWarehouse`, `createLocation` |
| `requireAdmin()` | `getAdminOverview`, `seedReferenceData`, `seedDemoInventory`, `resetInventory`, `setUserRole`, `deleteUser` |

This matters because server functions are ordinary HTTP endpoints. Disabling a button in the UI stops nobody from calling one directly, so the button state is a convenience and the guard is the control.

Lockout protections on user management: you cannot change your own role, cannot delete your own account, and the last remaining Admin can be neither demoted nor deleted.

---

## Feature reference

### Dashboard (`/`)

Five KPIs: total products in stock, low stock / out of stock, pending receipts, pending deliveries, internal transfers scheduled. Each card navigates to its filtered list.

Four filter dimensions apply live to both the KPIs and the operations table: document type, status, warehouse or location, product category. Active filters render as removable chips.

### Products (`/products`, `/products/$id`)

List with SKU search, category and stock-health filters. Detail view has four tabs:

- **Overview** — name, SKU, category, unit, total on hand, default location
- **Stock by Location** — the real per-location breakdown with a total row
- **Reordering Rule** — min, max, current on hand, suggested order quantity
- **Move History** — this product's ledger entries with a net total

Creating a product accepts optional opening stock, which is recorded as a real validated receipt so it appears in the ledger like any other movement.

### Categories (`/categories`) and Reordering Rules (`/reordering-rules`)

Category list with product counts. Rules table showing min, max, current on hand and suggested order, with rows below minimum highlighted. Editing a rule upserts it.

### Receipts (`/receipts`, `/receipts/$id`)

Status tabs with counts. The detail page is the fullest document editor: status stepper, supplier, scheduled date, destination location, source document, and an editable line table with product search, demand and received quantities.

The action bar changes with status — *Mark as Ready* while Draft or Waiting, *Validate* when Ready, read-only once Done. Validating shows the stock impact per line before committing.

### Delivery Orders (`/delivery-orders`) and Internal Transfers (`/internal-transfers`)

Filterable lists. Documents in `Ready` have a **Validate** action that runs the same `validateOperation` path as receipts, including the availability check that refuses to take stock below zero.

### Inventory Adjustments (`/inventory-adjustments`)

A counting sheet rather than a document form. Filter by location and category, enter counted quantities, and the difference computes live and signed. Each line carries a reason (`Damaged`, `Lost`, `Found`, `Miscount`, `Other`) which is written to the adjustment line. Applying creates one Adjustment document and moves each difference to or from Inventory Loss.

### Move History (`/move-history`)

The full ledger, read-only: date and time, reference, product, SKU, from, to, signed quantity, kind, status, done by. Filters for free text, date range, document type, location and category, with sortable date and pagination.

### Warehouses & Locations (`/warehouses`)

Two-pane settings view. Warehouse list on the left, selected warehouse's internal locations on the right, with virtual system-managed locations listed separately and labelled by kind.

### My Profile (`/profile`)

Real signed-in user data, editable name, a low-stock alert preference that persists, and a change-password form that requires the current password.

### About (`/about`)

A standalone marketing page rendered **outside** the application shell and reachable without signing in. Its call to action routes to the dashboard when signed in and to sign-in when not.

---

## Admin dashboard

`/admin`, visible in the sidebar to Admins only. Four regions ordered by how often they are needed.

**1. System health.** Leads because it answers "can this be used right now." Continuously verifies that the ledger sum equals the on-hand sum for every product, naming any product that disagrees. Also warns when the `Vendors`, `Customers` or `Inventory Loss` locations are missing, since without them no operation can be recorded at all. Row counts for all eleven tables sit underneath.

**2. Demonstration data.** Three actions, running the same routines as the seed CLI:

| Action | Effect | Safety |
|---|---|---|
| Load reference data | Categories, warehouses, locations including virtual ones, two demo logins | Idempotent, additive |
| Load demo inventory | 12 products, 6 completed and 10 in-flight documents, 21 ledger entries | Refuses if products already exist |
| Reset inventory | Deletes all inventory, documents, ledger, locations, warehouses, categories | Requires typing `RESET`; **never deletes user accounts** |

**3. Access control.** Every user with an inline role select, plus removal. Self-lockout protections described above are enforced server-side, not just disabled in the UI. Deleting a user preserves their history, since documents reference users with `ON DELETE SET NULL`.

**4. Runtime.** Environment, database host (host only, never credentials), session cookie name, and unused reset code count. Prominently flags the development-only behaviour where reset codes are returned to the browser.

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Framework | TanStack Start | Full-stack React with typed file routes and server functions — no separate API to deploy or keep in sync |
| Router | TanStack Router | Type-safe routes; invalid paths fail at compile time |
| UI | React 19 + TypeScript | The interface is form- and table-heavy |
| Components | shadcn/ui on Radix | Accessible primitives without adopting a whole design system |
| Styling | Tailwind CSS v4 | Dense data layouts without fighting CSS |
| Server state | TanStack Query | Cache invalidation after validating a document keeps every KPI honest |
| Database | Neon Postgres | Serverless Postgres; real enums, transactions and exact numerics |
| Driver | `@neondatabase/serverless` (`Pool`) | WebSocket pool, because the HTTP driver has no transactions |
| ORM | Drizzle | TypeScript-native schema, generated SQL migrations, typed queries |
| Validation | Zod | Every server function validates its input |
| Auth | WebCrypto PBKDF2 + encrypted cookie sessions | Runs identically on Node, Bun and Workers |
| Runtime | Bun | Package manager and script runner |
| Build target | Nitro → Cloudflare module | Produced by `vite build` |

TypeScript runs strict, with `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess` and `noPropertyAccessFromIndexSignature` all enabled. Optional properties are therefore set with conditional spreads rather than assigned `undefined`.

---

## Project structure

```
stocksense/
├── drizzle/                      Generated SQL migrations (commit these)
│   ├── 0000_old_runaways.sql     Initial 11 tables + 5 enums
│   └── 0001_handy_colleen_wing.sql  Adds the Admin role
├── src/
│   ├── assets/                   Images, including the About page SVGs
│   ├── components/
│   │   ├── ui/                   shadcn/ui primitives
│   │   ├── stock-shell.tsx       Sidebar, header, command palette, profile menu
│   │   ├── stock-pages.tsx       Dashboard, products, receipts, adjustments, history, settings
│   │   ├── master-data-dialogs.tsx  Create/edit dialogs for products, categories, rules, warehouses
│   │   ├── admin-page.tsx        Admin dashboard
│   │   ├── auth-page.tsx         Sign in, sign up, OTP reset
│   │   └── about-page.tsx        Standalone marketing page
│   ├── db/                       SERVER ONLY
│   │   ├── schema.ts             Drizzle schema, enums, relations, inferred row types
│   │   ├── index.ts              Neon pool + drizzle client, browser guard
│   │   ├── stock-engine.ts       applyMove, getOnHand, nextReference
│   │   ├── demo-data.ts          Shared dataset: seedBaseline, seedDemo, resetInventory, diagnostics
│   │   ├── seed.ts               CLI wrapper over demo-data
│   │   └── make-admin.ts         CLI to promote an account to Admin
│   ├── lib/
│   │   ├── stock-api.ts          Inventory server functions
│   │   ├── auth-api.ts           Auth and profile server functions
│   │   ├── admin-api.ts          Admin server functions
│   │   ├── guards.ts             requireUser / requireManager / requireAdmin
│   │   ├── session.ts            Session cookie configuration
│   │   ├── stock.tsx             Client inventory store (TanStack Query cache)
│   │   ├── auth.tsx              Client auth store
│   │   ├── error-reporting.ts    Vendor-neutral error capture with pluggable sinks
│   │   ├── error-capture.ts      Server-side error expansion for SSR
│   │   └── error-page.ts         SSR error page renderer
│   ├── server/
│   │   └── password.ts           PBKDF2 hash and verify
│   ├── routes/                   TanStack file routes (one file per URL)
│   ├── router.tsx                Router construction
│   ├── server.ts                 SSR entry with error normalization
│   └── styles.css
├── drizzle.config.ts
├── AGENTS.md                     Conventions for AI agents working in this repo
└── package.json
```

`src/db/**` and `src/server/**` must never be imported from client components. `src/server/**` is additionally blocked by the framework's import protection.

---

## Getting started

Requires **Bun** and a **Neon Postgres** database.

```bash
git clone https://github.com/Rohit-o9j/stocksense.git
cd stocksense
bun install
```

Create `.env` from the template and fill in both values:

```bash
cp .env.example .env
```

```ini
DATABASE_URL="postgresql://USER:PASSWORD@HOST-pooler.REGION.aws.neon.tech/DB?sslmode=require"
SESSION_SECRET="at-least-32-characters"
```

Generate a session secret:

```bash
bun -e "console.log(crypto.randomUUID().replace(/-/g,'')+crypto.randomUUID().replace(/-/g,''))"
```

Apply the schema and load data:

```bash
bun run db:migrate          # create tables and enums
bun run db:seed -- --demo   # reference data + demo inventory
```

Start the app:

```bash
bun run dev
```

Open `http://localhost:5173`. The seed prints its demo logins; both use the password `StockSense!2026`:

| Email | Role |
|---|---|
| `alex@stocksense.test` | Inventory Manager |
| `jordan@stocksense.test` | Warehouse Staff |

To reach the admin dashboard, promote an account:

```bash
bun run db:make-admin -- you@example.com
```

Then sign in as that account and open `/admin`, or use the **Admin** entry that appears in the sidebar.

> On a completely empty database you can skip the seed entirely: sign up through the UI and the first account becomes Admin automatically. Then load the reference data from the admin dashboard.

---

## Scripts

| Script | Purpose |
|---|---|
| `bun run dev` | Development server with HMR |
| `bun run build` | Production build (client, SSR, Nitro) |
| `bun run preview` | Serve the production build |
| `bun run lint` | ESLint |
| `bun run format` | Prettier |
| `bun run db:generate` | Generate a migration from schema changes |
| `bun run db:migrate` | Apply pending migrations |
| `bun run db:studio` | Drizzle Studio |
| `bun run db:seed` | Reference data only |
| `bun run db:seed -- --demo` | Reference data + demo inventory |
| `bun run db:seed -- --reset` | Clear inventory first (accounts are preserved) |
| `bun run db:make-admin -- <email>` | Promote an account to Admin |

> `db:push` exists but is **not recommended**. It recreates tables it considers drifted, which silently empties them. Use `db:generate` followed by `db:migrate` so every change is a reviewable, committed SQL file.

---

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Neon pooled connection string. Must **not** be `VITE_`-prefixed, or Vite would inline the credential into the client bundle |
| `SESSION_SECRET` | yes | At least 32 characters; encrypts and signs the session cookie |
| `NODE_ENV` | no | When not `production`, password reset codes are returned to the browser for testing |

`.env` is gitignored. `.env.example` documents the shape with placeholder values and is committed.

---

## Database migrations

Schema changes follow a fixed loop:

1. Edit `src/db/schema.ts`
2. `bun run db:generate` — writes a new file to `drizzle/`
3. Read the generated SQL before applying it
4. `bun run db:migrate`
5. Commit both the schema change and the generated SQL

Current migrations:

| File | Contents |
|---|---|
| `0000_old_runaways.sql` | 11 tables, 5 enums, 17 foreign keys, 21 indexes |
| `0001_handy_colleen_wing.sql` | Adds `Admin` to `user_role` |

---

## Demonstration data

One dataset, defined once in `src/db/demo-data.ts` and used by both the CLI and the admin dashboard.

**Reference data** — 4 categories, 2 warehouses, 6 internal locations, 3 virtual locations, 2 demo logins. Idempotent and additive; safe to run against a database that already holds real accounts.

**Demo inventory** — 12 products across the 4 categories, 6 completed documents, 10 in flight across all four kinds and every status, 21 ledger entries. Includes 2 out-of-stock and several below-minimum products so the low-stock KPI and alerts are populated.

All stock is created by running **real moves through the engine**, never by writing quantities directly. Ledger and on-hand agreement is therefore structural rather than coincidental, which is what makes the admin health check meaningful.

**Reset** deletes inventory but never user accounts, so clearing demo data cannot lock anyone out.

---

## Conventions for contributors

These are enforced by review, and documented for agents in `AGENTS.md`:

1. **Never write `stock_quants` directly.** Use `applyMove` inside a transaction.
2. **Every server function starts with a guard.** No exceptions beyond the public auth endpoints.
3. **Never import `src/db/**` or `src/server/**` from client components.**
4. **Keep `DATABASE_URL` un-prefixed.** A `VITE_` prefix would leak it to the browser.
5. **Use the neon-serverless pool**, not `neon-http`; the engine needs transactions.
6. **Commit generated migrations** alongside schema changes.
7. **Don't put client-imported files under `src/server/`** — import protection denies that path.
8. Inventory data is read through `src/lib/stock-api.ts`; `src/lib/stock.tsx` is a cache, not a source of truth.

---

## Known limitations

Honest list of what is incomplete:

- **Counting sheet is keyed by product, not by (product, location).** It filters on a product's primary location and counts against its total on hand, so a product split across several locations behaves inconsistently when filtering by location. Fixing this properly means reworking the sheet, not patching it.
- **No email provider.** Password reset codes are returned in the response outside production and logged to the console. This must be wired to a mail service before any real deployment.
- **Product editing is read-only.** Products can be created but not yet edited; the Edit button is inert.
- **CSV export is not implemented** on Move History.
- **Delivery and transfer documents have no detail page.** They can be listed and validated, but not composed line by line like receipts.
- **Reference number allocation has a race.** Two documents created simultaneously can pick the same number; the unique index turns that into a failed insert rather than a duplicate, and the caller can retry.
- **Location hierarchy is flat in practice.** The schema supports `parent_id`, but the seed and UI treat locations as a flat list.
