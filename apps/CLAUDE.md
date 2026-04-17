# apps/

Four deployable services:

- **api/** — Express HTTP server. Receives GitHub + Razorpay webhooks, serves the JSON API, handles GitHub OAuth login, proxies the marketing contact form to Zoho SMTP. Deployed to Fly.io.
- **web/** — React + Vite single-page dashboard at `app.grassion.com`. Deployed to Vercel.
- **marketing/** — Astro static site at `grassion.com` (landing, about, pricing, contact, privacy, terms). Deployed to Vercel as a separate project.
- **worker/** — Headless Node process. Runs cron jobs (outcome tracking every 6h, weekly digest emails, OpenAI PR summaries). Deployed to Fly.io with `min_machines_running = 1`.

Each app has its own `package.json`, `tsconfig.json`, and CLAUDE.md. They share types via `@grassion/shared` and DB access via `@grassion/db`.
