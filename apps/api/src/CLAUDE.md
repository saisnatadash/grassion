# apps/api/src

Source root. `index.ts` is the binary entry; `app.ts` is the testable Express factory.

## Module rules

- Never import a route directly into another route — go through services.
- DB writes belong in `services/`, never in route or webhook handlers.
- Auth: `requireAuth` for any `/api/*` endpoint that reads team data. Add `requireRole('owner', 'admin')` for mutations of team config or billing.
- All env reads go through `env()` in `env.ts`. Cache the result to avoid re-parsing.
