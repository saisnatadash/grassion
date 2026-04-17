# packages/shared — Cross-cutting types and utilities

Shared between API, worker, and web. **No runtime dependencies on Node-only or browser-only modules.** Anything here must be portable to all three environments.

## Layout

- `src/types.ts` — DTOs and unions (`AiSource`, `Verdict`, `Plan`, `DashboardSummary`, etc).
- `src/schemas.ts` — Zod request schemas used by the API for validation. The web app uses `z.infer<typeof X>` to get matching types.
- `src/dates.ts` — `daysAgo`, `addDays`, `hoursBetween`, `startOfWeekUtc`, `lastNWeeks`. Avoid `date-fns` here so the bundle stays small.
- `src/verdict.ts` — `verdictLabel`, `verdictColor`, `verdictEmoji` for consistent display.

## Rules

- No DB imports. The DB schema lives in `@grassion/db`.
- No `process.env` access. Pass config in.
- No I/O. Everything in this package must be pure.
