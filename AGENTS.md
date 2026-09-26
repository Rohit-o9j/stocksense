<!-- LOVABLE:BEGIN -->

> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

<!-- LOVABLE:END -->

- Use TanStack file routes with a shared application shell, because this template's router is fixed and each screen needs its own URL and metadata.
- Read and write inventory data through the server functions in `src/lib/stock-api.ts`. StockSense is backed by Neon Postgres; `src/lib/stock.tsx` is a TanStack Query cache over those functions, not a source of data. Do not reintroduce hardcoded inventory.
- Do not put files imported by the client under `src/server/`. TanStack Start's import protection denies the `**/server/**` pattern in the client environment, which is why the server functions live in `src/lib/stock-api.ts`.
- Never write `stock_quants` directly. Every quantity change goes through `applyMove` in `src/db/stock-engine.ts`, inside `db.transaction()`, so the ledger and on-hand quantities cannot disagree.
- Keep `src/db/*` and `src/server/*` out of client components. `DATABASE_URL` is deliberately not `VITE_`-prefixed so Vite cannot inline it into the browser bundle.
- Use the `drizzle-orm/neon-serverless` pool, not `neon-http`. The HTTP driver has no transaction support, which the stock engine requires.
- After changing `src/db/schema.ts`, run `bun run db:generate` and commit the generated SQL in `drizzle/`.
