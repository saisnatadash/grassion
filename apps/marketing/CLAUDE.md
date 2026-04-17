# apps/marketing — Astro marketing site

The public-facing site at `grassion.com`. Astro + Tailwind. Static HTML output, deployed to Vercel.

## Pages

| Path | File | Notes |
|---|---|---|
| `/` | `pages/index.astro` | Hero + how it works + pricing teaser + FAQ + final CTA |
| `/about/` | `pages/about.astro` | Why Grassion exists, who built it |
| `/pricing/` | `pages/pricing.astro` | 4-tier card grid + billing FAQ |
| `/contact/` | `pages/contact.astro` | Form posts to `${PUBLIC_API_URL}/api/contact` |
| `/privacy/` | `pages/privacy.astro` | Static prose |
| `/terms/` | `pages/terms.astro` | Static prose |
| `/404` | `pages/404.astro` | Custom 404 |
| `/sitemap.xml` | `pages/sitemap.xml.ts` | Hand-rolled sitemap (all 6 paths) |
| `/robots.txt` | `public/robots.txt` | Allow all + sitemap pointer |

## Conventions

- Copy comes from `SPEC2.md` section 6. Don't paraphrase without product approval.
- All chrome (header + footer + meta tags) is in `layouts/Base.astro`. Pages just pass `title` + `description`.
- Tailwind via `@astrojs/tailwind` with `applyBaseStyles: false`. Global resets live in `styles/global.css`.
- Page URLs are directory-form (`/about/`) — Astro is configured with `build.format: 'directory'` and Vercel `trailingSlash: true`.
- The contact form uses a hidden honeypot field named `website` — humans never fill it; bots usually fill every field. The API silently 200s honeypot hits.

## Env

- `PUBLIC_APP_URL` — used to build "Sign in" / "Start free trial" links. Defaults to `https://app.grassion.com`.
- `PUBLIC_API_URL` — used by the contact form to POST `/api/contact`.
- `MARKETING_URL` — read by `astro.config.mjs` to set `site` (used in canonical URLs and the sitemap).

## Deploy

Deploy as a separate Vercel project pointing at `apps/marketing/`. The `vercel.json` here pins build/install commands. Runs alongside the dashboard project (which deploys `apps/web/`).
