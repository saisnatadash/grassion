# apps/api — Express backend

The HTTP entry point: GitHub + Razorpay webhooks, the REST JSON API for the dashboard, the GitHub OAuth login flow, and the marketing-site contact form proxy.

## Boot

`src/index.ts` → builds `app` from `src/app.ts` → listens on `PORT` (default 3001). SIGTERM/SIGINT close the DB pool gracefully.

## Middleware order (matters)

1. `pino-http` request logging
2. `helmet`
3. `cors` (allows `APP_URL` + `MARKETING_URL` with credentials)
4. **Webhook raw-body routes** registered BEFORE `express.json()` — Razorpay and GitHub need the raw byte string for signature verification
5. `express.json()` for everything else
6. `cookie-parser`
7. `attachSession` populates `req.session` if the cookie is valid
8. Per-IP rate limit on `/api/`
9. Routes
10. 404 handler
11. Error handler (last)

## Code map

- `env.ts` — Zod-validated environment variables. Don't read `process.env` directly elsewhere.
- `logger.ts` — pino instance. Pretty in dev, JSON in prod.
- `db.ts` — singleton Drizzle client.
- `github.ts` — Octokit App + per-installation Octokit factory.
- `auth.ts` — session token issue/verify, cookie helpers, `requireAuth`/`requireRole` middleware.
- `routes/` — REST handlers, one router per resource.
- `webhooks/` — GitHub + Razorpay webhook entry points (raw body required).
- `services/` — business logic, called from both routes and webhooks.
- `billing/razorpay.ts` — Razorpay SDK singleton and signature helpers.

## Testing

`pnpm test` runs Vitest. Pure logic (AI detection, services with mocked DB) is the priority. Don't write integration tests against a real GitHub or Razorpay — use fixtures.
