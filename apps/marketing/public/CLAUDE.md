# apps/marketing/public

Static assets served as-is at the site root.

- `favicon.svg` — the Grassion mark. Inline SVG, ~250 bytes.
- `robots.txt` — `Allow: /` + sitemap pointer.

Add OG images here (`og.png`, etc.) when you have artwork. The `Base.astro` layout already references `/og.png` by default.
