# apps/api/src/webhooks

Inbound webhook handlers. Both endpoints require the **raw request body** for signature verification — make sure the route is registered with `express.raw(...)` BEFORE `express.json()`.

## github.ts

Verifies via `@octokit/webhooks` using `GITHUB_APP_WEBHOOK_SECRET`. Handles:

- `installation.created/deleted` — create/deactivate team, connect/disconnect repos, kick off backfill.
- `installation_repositories.added/removed` — sync repo list mid-life.
- `pull_request.*` — upsert PR row + run AI detection. On merge, schedule an outcome check 7 days out.
- `check_run.completed` — store check status against the matching PR for later CI-failure tallies.

Returns 202 on success (per GitHub recommendation), 400 on signature failure.

## razorpay.ts

Verifies via `verifyWebhookSignature` (HMAC-SHA256 of the raw body with `RAZORPAY_WEBHOOK_SECRET`). Handles:

- `subscription.activated/charged/updated/resumed/authenticated/pending` → sync subscription state on the team row.
- `subscription.cancelled/completed/expired/halted/paused` → demote plan to `trial`, persist last status.
- `payment.failed` → log warning with the `error_code` so we can investigate.
- `payment.captured` → log info; no DB write (the subscription event covers state).

Subscription events look up the team by `notes.team_id` first (set when we created the subscription) and fall back to `razorpay_subscription_id` when notes are missing.

## Don't

- Don't do heavy work synchronously inside the handler. Schedule it via `outcome_check_queue` or a fire-and-forget `Promise.catch(log)`. GitHub will retry if we exceed 10s.
- Don't trust `installation.id` to look up a team if the team might have uninstalled — fall back to the team-by-account-login lookup where applicable.
