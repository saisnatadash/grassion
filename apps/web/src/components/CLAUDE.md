# apps/web/src/components

Reusable React components.

- `ui.tsx` — design-system primitives (Card, CardHeader, CardTitle, CardContent, Button, Badge, Alert, Spinner). Add new shared primitives here rather than per-page.
- `Layout.tsx` — auth-gated chrome for the app (header + nav + outlet). Redirects to `/login` on 401.

Keep components thin. Page-specific composition belongs in `pages/`.
