# apps/worker/src

Source root for the worker.

`index.ts` registers cron handlers and runs the outcome pass once on boot. All scheduled work goes through `node-cron`. SIGTERM/SIGINT close the DB pool, then exit.

## Subdirs

- `emails/` — text + HTML body builders + Resend wrapper for the weekly digest.
- `llm/` — OpenAI client + budget-guarded `summarizeProblemPR`. The only sanctioned LLM call site; see `llm/CLAUDE.md` for budget rules.

## Scoring math (don't change without reason)

`computeReworkScore` in `outcome-tracker.ts`:

- Reverted: +60
- Each downstream "fixes #N": +15 (capped at 30)
- Each CI failure: +5 (capped at 20)
- Hotfix within 7 days: +25
- Total clipped to 100

PRs with `reworkScore > 30` count as "rework PRs" in metrics; PRs with `reworkScore >= 30` show on the dashboard's problem list.

## Verdict math

`computeWeeklyMetricsForTeam` in `metrics.ts`:

- `estimatedHoursSaved = max(0, humanAvg - aiAvg) * aiPrCount * 0.3` (the 0.3 is the dampener — merge speed ≠ dev time saved 1:1)
- `estimatedHoursLost = reworkPrCount * 3`
- `estimatedDollarLost` adds the weekly share of `monthlyAiSpendUsd`
- Verdict: `insufficient_data` (<5 PRs), else `net_positive` (>+$100), `net_negative` (<-$100), or `unclear`

These numbers are intentionally rough and are disclosed to the user as estimates.
