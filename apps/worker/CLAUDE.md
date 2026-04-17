# apps/worker — Cron jobs

Headless Node process. No HTTP. Two scheduled jobs:

| Job | Schedule (default) | What it does |
|---|---|---|
| **Outcome tracker** | every 6h (`OUTCOME_CRON`) | For PRs in the queue (or merged 7-30d ago and missed), compute reverts, downstream "fixes #N" PRs, CI failures, hotfix-within-7d, and a composite rework score. For PRs scoring ≥30 with no cached summary yet, also generates a one-line OpenAI summary and caches it in `pr_outcomes.ai_summary`. |
| **Weekly digest** | hourly tick | Re-computes last week's metrics, then sends a digest email to teams whose configured `emailDigestDay` (UTC) is today. Idempotent via `email_digests` table check. Uses cached `ai_summary` per problem PR when present, deterministic signal string otherwise. |

Outcome tracker also runs once on boot so we don't wait 6h after a deploy.

## Code map

- `outcome-tracker.ts` — pulls due rows from `outcome_check_queue`, computes outcomes, generates AI summaries on-demand, sweeps PRs that missed enqueue.
- `metrics.ts` — computes weekly metrics for one team or all. Honest ROI math with documented dampeners.
- `digest-runner.ts` — sends the weekly email per team via Resend.
- `emails/weekly-digest.ts` — text + HTML body builders + subject line.
- `emails/send.ts` — Resend wrapper.
- `llm/pr-summary.ts` — OpenAI client + monthly budget guard. Falls back to a deterministic string when over budget or on API error.

## Rules

- Crons must be idempotent. Re-running the same job for the same week/day must not double-send emails or double-charge OpenAI.
- Cron handlers must catch and log all errors. An unhandled rejection in node-cron crashes the process.
- Keep one machine alive on Fly (`min_machines_running = 1`). Auto-stop would defeat scheduling.
- LLM usage is bounded by `OPENAI_MONTHLY_BUDGET_USD`. The check reads `llm_usage_log` and short-circuits to the deterministic fallback when exceeded — we never throw from the summary path.
