# apps/web/public

Static assets served as-is by Vite. Files here are copied to the build output verbatim and are addressable from the root URL (e.g. `/favicon.svg`).

Keep this directory small — only true static assets that need a stable URL. Anything imported from TS/JSX should live under `src/` so Vite can hash and tree-shake it.
