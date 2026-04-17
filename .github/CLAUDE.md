# .github

GitHub-hosted configuration: CI/CD workflows.

## workflows/

- `ci.yml` — runs typecheck, tests, and build on every pull request and on push to `main`.
- `deploy.yml` — runs after CI on `main` to deploy:
  - **API** to Fly.io via `fly.api.toml`
  - **Worker** to Fly.io via `fly.worker.toml`
  - **Web** to Vercel

## Required secrets

| Secret | Used by |
|---|---|
| `FLY_API_TOKEN` | both Fly deploys |
| `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` | web deploy |
| `VITE_API_URL` | web build (baked into the bundle) |

Create them under repo Settings → Secrets and variables → Actions.
