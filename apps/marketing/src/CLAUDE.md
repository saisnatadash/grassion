# apps/marketing/src

Astro source root.

- `layouts/Base.astro` — single chrome wrapper (head meta + Nav + main + Footer). All pages render through this. Pass `title` and `description`.
- `pages/` — file-routed. `.astro`/`.md` files become HTML pages; `.ts` files export `APIRoute` (used for `sitemap.xml`). **Don't put a `CLAUDE.md` inside `pages/`** — Astro would route it as `/CLAUDE/`. Page-level guidance belongs in this file.
- `components/Nav.astro` and `components/Footer.astro` — site chrome. Edit here, not in `Base.astro`.
- `styles/global.css` — Tailwind entry + a thin `prose-grassion` class for long-form pages (about, privacy, terms).
- `env.d.ts` — augments `ImportMetaEnv` for `PUBLIC_*` vars.

## Pages conventions

- Wrap content in `<Base ...>` and pass `title` / `description`.
- New pages must be added to `pages/sitemap.xml.ts` and to `Footer.astro` if they're navigable.
- The contact form posts to `${PUBLIC_API_URL}/api/contact` from inline JS in `contact.astro`. The script uses `is:inline` so Astro doesn't try to bundle it, and `define:vars={{ API_URL }}` to inject the env value into client code.

## Editing copy

The marketing copy in these files is the source of truth — `SPEC2.md` section 6 is the original. If you change a page, update both so the spec stays accurate.
