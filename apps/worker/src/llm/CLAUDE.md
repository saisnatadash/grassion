# apps/worker/src/llm

OpenAI client + budget-guarded summary generation. The only sanctioned LLM call site in the codebase.

## Files

- `pr-summary.ts` — `summarizeProblemPR(pr)` returns a one-line, human-readable explanation of why a PR misfired ("Reverted within 3 days; one downstream fix referenced this PR."). Used by the worker when caching `pr_outcomes.ai_summary` for problem PRs.

## Rules

- **Budget guard, never throw.** `isBudgetExceeded()` sums `llm_usage_log.estimated_cost_usd` for the current UTC month. When the total reaches `OPENAI_MONTHLY_BUDGET_USD`, the function short-circuits to `fallbackSummary(pr)` (a deterministic string built from the same signals). API errors are caught and also fall back. The cron must never crash because OpenAI 5xx'd.
- **Record every call.** After a successful completion, insert a `llm_usage_log` row with the total token count and an estimated USD cost (`tokens * COST_PER_TOKEN_USD`).
- **One model.** `OPENAI_MODEL` defaults to `gpt-4o-mini` and the cost constant is calibrated for that model. If you change models, update `COST_PER_TOKEN_USD`.
- **Bounded outputs.** `max_tokens: 80`, `temperature: 0.3`. Summaries are meant to fit in a single line of the dashboard or email.
- **No PII in prompts.** Pass only PR title, repo name, and the computed signal counts — never the diff, commit author email, or PR body.
