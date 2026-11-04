# Grassion — Route Plan Enforcement Table

Every API route and its minimum plan requirement.
Routes not listed here are either public (no auth) or free-plan accessible.

## Minimum plan key

| Symbol | Plan |
|--------|------|
| FREE   | Any authenticated team (`free`, `trial`, legacy `starter`, etc.) |
| PRO    | `pro`, `growth`, `team`, `business`, `enterprise`, `admin` |
| BIZ    | `business`, `enterprise`, `admin` |

---

## Analytics routes (`apps/api/src/routes/analytics.ts`)

| Route | Method | Min plan | Notes |
|-------|--------|----------|-------|
| `/api/analytics/dashboard` | GET | FREE | Weekly summary, verdict |
| `/api/analytics/metrics` | GET | FREE | Speed delta, rework rate |
| `/api/analytics/outcomes` | GET | FREE | Aggregate outcome stats |
| `/api/analytics/prs` | GET | FREE | PR list |
| `/api/analytics/pr-outcomes` | GET | **PRO** | Individual PR quality + AI summaries |
| `/api/analytics/pr-decay/:prId` | GET | **PRO** | Decay timeline checkpoints |
| `/api/analytics/benchmark` | GET | **BIZ** | Cross-team benchmarking |
| `/api/analytics/rfg` | GET | **PRO** | Repeat Failure Guard analysis |

## HC (Human Coverage) routes (`apps/api/src/routes/hc.ts`)

| Route | Method | Min plan | Notes |
|-------|--------|----------|-------|
| `/api/hc/coverage` | GET | **PRO** | Coverage snapshot |
| `/api/hc/coverage` | DELETE | **PRO** | Wipe all coverage data (owner only) |
| `/api/hc/areas` | GET | **PRO** | Coverage area list |
| `/api/hc/check-runs` | GET | **PRO** | Check run history |
| `/api/hc/backfill` | POST | **PRO** | Trigger backfill |

## MCP token routes (`apps/api/src/routes/mcp-tokens.ts`)

| Route | Method | Min plan | Notes |
|-------|--------|----------|-------|
| `/api/mcp-tokens` | GET | **PRO** | List tokens (enforced inline) |
| `/api/mcp-tokens` | POST | **PRO** | Create token (enforced inline) |
| `/api/mcp-tokens/:id` | DELETE | **PRO** | Revoke token |

## Team routes (`apps/api/src/routes/team.ts`)

| Route | Method | Min plan | Notes |
|-------|--------|----------|-------|
| `/api/team` | GET | FREE | Team settings |
| `/api/team` | PATCH | FREE | Update settings |
| `/api/team/members` | GET | FREE | Member list |
| `/api/team/settings` | PATCH | FREE | Per-seat cost settings |

## Webhook-driven Pro features (server-side plan checks in webhook handlers)

| Feature | Handler | Min plan |
|---------|---------|----------|
| HC check runs (GitHub checks:write) | `apps/api/src/services/hc-check.ts` | **PRO** |
| Slack `/who` command | `apps/api/src/routes/slack-commands.ts` | **PRO** |
| Monday digest | `apps/worker/src/jobs/digest.ts` | **PRO** |
| MCP server queries | `apps/mcp/src/index.ts` | **PRO** |

## Public routes (no auth required)

| Route | Notes |
|-------|-------|
| `/auth/github` | GitHub OAuth initiation |
| `/auth/github/callback` | OAuth callback |
| `/api/contact` | Contact form (rate-limited + honeypot) |
| `/api/billing/webhook` | Razorpay webhook (signature-verified) |
| `/webhooks/github` | GitHub webhook (HMAC-verified) |
| `/health` | Health check |
| `/api/demo/*` | Demo mode (env-gated) |
