# apps/marketing/src/layouts

Page layouts. Currently just `Base.astro`.

`Base.astro` owns: `<head>` meta tags, OG/Twitter card, canonical URL, theme color, the chrome (Nav + Footer), and the `<main>` container width. Pages render their content into the default slot.

If you add a new layout (e.g. for a future `/blog/`), keep `Base.astro` as the parent so site-wide tags don't drift.
