# apps/api/src/services

Business logic. Pure-ish functions called from routes and webhooks.

| File | Purpose |
|---|---|
| `teams.ts` | Create teams from GitHub installations; deactivate on uninstall; user upserts. |
| `repos.ts` | Connect/disconnect a GitHub repo to a team. |
| `prs.ts` | Upsert pull requests from webhook payloads, schedule outcome checks, store check-run results, recompute AI detection on label change. |
| `ai-detection.ts` | Pure function `detectAI(pr)` returning source/method/confidence. **Priority order: label > trailer > body regex.** Has unit tests. |
| `backfill.ts` | On install, page through the last 60 days of PRs per repo and persist them. Idempotent via `ON CONFLICT`. |

## Rules

- Service functions own all DB writes for their resource.
- Never throw without context — wrap with descriptive `Error` messages so logs are searchable.
- Backfill is fire-and-forget from webhooks. Errors are logged, not surfaced to the user.
