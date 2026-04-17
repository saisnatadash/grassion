# Grassion — Repository Guide

Grassion is a GitHub App that measures whether a small engineering team's AI-coding-tool spend is paying off. Read [SPEC.md](./SPEC.md) for the v1 product spec and [SPEC2.md](./SPEC2.md) for the v2 deltas (Razorpay billing, OpenAI PR summaries, Zoho SMTP for the contact form, full Astro marketing site).

## Layout

```
apps/
  api/        Express server — webhooks, REST API, auth, billing, contact form
  web/        React + Vite dashboard (app.grassion.com)
  marketing/  Astro static site (grassion.com): home, about, pricing, contact, privacy, terms
  worker/     Node cron — outcome tracker, weekly metrics, email digest, OpenAI PR summaries
packages/
  db/         Drizzle ORM schema + migrations + Postgres client
  shared/     TS types, Zod schemas, date helpers shared across apps
```

## Conventions

- **Package manager:** pnpm 9 workspaces (do not use npm or yarn).
- **Module system:** ESM everywhere; relative TS imports use `.js` suffix to satisfy NodeNext.
- **TypeScript:** strict + `noUncheckedIndexedAccess`. Errors must be fixed, not silenced.
- **Comments:** only when the WHY is non-obvious. Don't restate code.
- **Commits/PRs:** small, behavior-first; use Conventional Commits if helpful (`feat:`, `fix:`).
- **Secrets:** never commit; everything goes through `.env` (template at `.env.example`).

## Common commands

```bash
pnpm install                    # install all workspaces
pnpm dev                        # run api + web + marketing + worker in parallel
pnpm typecheck                  # type-check every workspace
pnpm test                       # vitest across workspaces
pnpm build                      # build api + worker + web + marketing
pnpm db:generate                # generate Drizzle SQL from schema diff
pnpm db:migrate                 # apply migrations against $DATABASE_URL
```

## Architecture quick reference

- **Webhooks (`apps/api/src/webhooks/`)** ingest events from GitHub and Razorpay. They mutate state via services in `apps/api/src/services/`.
- **REST routes (`apps/api/src/routes/`)** read state for the dashboard; `routes/contact.ts` is the only public route (rate-limited + honeypot).
- **Worker (`apps/worker/src/`)** runs scheduled jobs: outcome tracker (every 6h, also generates OpenAI summaries for problem PRs), weekly metrics + digest (hourly tick, gated by team's UTC weekday/hour). LLM usage is capped via `OPENAI_MONTHLY_BUDGET_USD` and tracked in the `llm_usage_log` table.
- **Marketing (`apps/marketing/`)** is a static Astro build. The contact form posts to the API.
- **Database** lives in Neon Postgres; schema is the single source of truth in `packages/db/src/schema.ts`.

## Don't

- Don't add features outside [SPEC.md](./SPEC.md) and [SPEC2.md](./SPEC2.md). The specs are a contract.
- Don't bypass the AI detection priority order: label > trailer > body regex.
- Don't bake secrets into Dockerfiles or env defaults.
- Don't introduce LLM calls outside the worker's `llm/pr-summary.ts` flow — that's the only sanctioned use of OpenAI in v1, and it carries a budget guard.
- Don't reintroduce Stripe code in v1. Razorpay is the primary processor; Stripe is deferred per SPEC2.md.
