# apps/web/src

Source root.

- `main.tsx` mounts `<App />`.
- `App.tsx` wires `QueryClientProvider` + `BrowserRouter` + the route table.
- `pages/` — top-level routed pages, one per file.
- `components/` — reusable React components, including the auth-gated `AppLayout`.
- `lib/` — non-React utilities (API client, formatting helpers).
- `styles.css` — Tailwind entry + a few base resets.

## TypeScript imports

We use ESM with `.js` suffixes on relative imports so the same source compiles via tsc and works under Node-style module resolution if ever needed.
