# Grassion

> Measure whether your AI coding tool spend (Copilot, Cursor, Claude Code) is actually paying off.

Grassion is a GitHub App that detects AI-generated PRs automatically (via commit trailers and PR labels), tracks what happens to them after merge (reverts, rework, hotfixes, CI failures), and produces a weekly email + dashboard showing the ROI verdict in plain English.

**Target buyer:** founding engineers and CTOs at 5–25 dev startups.
**Price:** $29/dev/month.

## Repository Structure

```
grassion/
├── apps/
│   ├── api/              # Express backend — webhooks, REST API, auth
│   ├── web/              # React + Vite frontend — dashboard, settings
│   └── worker/           # Node cron — outcome tracker, weekly email
├── packages/
│   ├── db/               # Drizzle schema + migrations (shared)
│   └── shared/           # TypeScript types shared between api/web/worker
├── .github/workflows/    # CI deploy to Fly.io + Vercel
├── fly.api.toml
├── fly.worker.toml
├── package.json          # root pnpm workspace
└── pnpm-workspace.yaml
```

## Quick Start

```bash
# Install
pnpm install

# Set up env
cp .env.example .env
# Fill in DATABASE_URL, GitHub App credentials, etc.

# Run migrations
pnpm db:migrate

# Dev (runs api, web, worker in parallel)
pnpm dev
```

## Deployment

- **API + Worker:** Fly.io (`fly deploy` in `apps/api` and `apps/worker`)
- **Web:** Vercel (`vercel --prod` in `apps/web`)
- **Postgres:** Neon

See [SPEC.md](./SPEC.md) for complete architecture and build plan.

## License

UNLICENSED — proprietary.
