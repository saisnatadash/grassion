# .github/workflows

GitHub Actions definitions.

- `ci.yml` — required checks: `pnpm typecheck`, `pnpm test`, `pnpm build`.
- `deploy.yml` — gated on `ci.yml` passing on `main`. Deploys api+worker to Fly and web to Vercel in parallel.

If you add a new workflow, prefer reusing the existing pnpm cache + Node setup actions to keep CI cold-start time down.
