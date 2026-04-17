# apps/marketing/src/components

Reusable Astro components used by `Base.astro`.

- `Nav.astro` — top header. Reads `PUBLIC_APP_URL` for the "Sign in" CTA.
- `Footer.astro` — bottom footer with sitemap-style links + legal entity line.

Keep components simple — no client JS unless the page already needs it. Astro renders to static HTML; we only ship JS where it's required (e.g., the contact form).
