# packages/

Internal libraries shared by the apps. Both are private and exported via the `workspace:*` protocol.

- **db/** — Drizzle schema + migrations + Postgres client. The schema in `db/src/schema.ts` is the single source of truth for all table shapes.
- **shared/** — TypeScript types, Zod request schemas, date helpers, and verdict utilities used by both backend and frontend.

Do not import from `apps/*` here. The dependency direction is one-way: apps → packages.
