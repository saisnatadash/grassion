# packages/db/src

The schema and client live here.

## Tables

| Table | Owner | Purpose |
|---|---|---|
| `teams` | self | One row per GitHub installation. Holds Razorpay billing + AI-spend config. |
| `users` | team | GitHub users in a team. `users_team_gh_idx` makes (teamId, githubUserId) unique. |
| `repos` | team | GitHub repos connected to a team. `isActive` flag pauses ingestion. |
| `pull_requests` | team + repo | One row per GitHub PR. Stores AI detection result + raw metadata for re-processing. |
| `pr_outcomes` | pr | Computed by the worker. Reverts, downstream fixes, CI failures, hotfix flag, composite score, plus optional cached `aiSummary`. |
| `team_weekly_metrics` | team | Cached weekly roll-up. Unique on (teamId, weekStart). |
| `sessions` | user | Cookie-token sessions. Token is hashed; raw token is in the cookie JWT. |
| `email_digests` | team | Send log for the weekly digest. Used for idempotency. |
| `outcome_check_queue` | pr | Deferred outcome computation. Worker pulls due rows. |
| `llm_usage_log` | none | Token + USD usage of OpenAI calls; the worker reads this to enforce `OPENAI_MONTHLY_BUDGET_USD`. |

## Tips

- Adding a column: edit the table definition, run `pnpm db:generate`, review SQL.
- Adding a relation: declare it in the corresponding `*Relations` block at the bottom of `schema.ts`.
- Inferred types are exported (`Team`, `NewTeam`, `LlmUsageLogRow`, etc.) — use those instead of redefining.

## Razorpay columns

`teams.razorpay_customer_id` and `teams.razorpay_subscription_id` are nullable until checkout completes. `teams.subscription_status` mirrors Razorpay's status string verbatim (`active`, `halted`, `cancelled`, …) so we can debug from the DB without calling the API. `teams.current_period_end` is filled from `subscription.current_end` on webhook receipt.
