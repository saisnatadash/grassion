# packages/db — Drizzle schema + Postgres client

Single source of truth for the database. Both `apps/api` and `apps/worker` depend on this package.

## Layout

- `src/schema.ts` — table definitions and relations.
- `src/client.ts` — singleton `postgres` connection + `drizzle()` wrapper. Lazy-initialized; closes on `closeDb()`.
- `src/index.ts` — re-exports schema, client, and the most-used Drizzle helpers (`eq`, `and`, `gt`, etc).
- `src/migrate.ts` — invoked by `pnpm db:migrate` to apply migrations from `./migrations`.
- `migrations/` — generated SQL + meta. Always commit these.

## Workflow

1. Edit `src/schema.ts`.
2. Run `pnpm db:generate` to produce a new SQL migration.
3. Review the generated SQL.
4. Apply with `pnpm db:migrate`.
5. Commit both schema and migration files together.

`pnpm db:push` is for fast local iteration only — do not use against production.

## Conventions

- All `id` columns are `uuid` with `defaultRandom()`.
- All timestamps use `timestamp('foo').defaultNow().notNull()` for created_at, nullable for completed_at-style fields.
- Foreign keys use `onDelete: 'cascade'` from teams downward (everything is owned by a team).
- Indexes are declared in the second-arg callback `(t) => ({...})`.
