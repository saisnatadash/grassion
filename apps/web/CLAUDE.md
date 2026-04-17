# apps/web — React + Vite frontend

Single-page dashboard. Vite for dev/build, React 18, React Router, TanStack Query, Tailwind CSS.

## Pages

| Path | File | Notes |
|---|---|---|
| `/login` | `pages/Login.tsx` | "Continue with GitHub" button → `/auth/github` on the API. |
| `/install` | `pages/Install.tsx` | Sends user to the GitHub App install URL. |
| `/dashboard` | `pages/Dashboard.tsx` | The whole product: verdict + 4 stat cards + problem PRs. Handles `insufficient_data`. |
| `/settings` | `pages/Settings.tsx` | Team config, repo toggles, member list. |
| `/billing` | `pages/Billing.tsx` | Razorpay subscription create + JS SDK Checkout + cancel-at-period-end. |
| `/onboarding` | `pages/Onboarding.tsx` | 3-step wizard after first install. |

Authenticated pages render through `components/Layout.tsx`, which redirects unauthenticated visitors to `/login`.

## Conventions

- Network access only via `lib/api.ts`. Don't `fetch` directly elsewhere.
- All requests include `credentials: 'include'` so the session cookie is sent.
- Use TanStack Query for reads; `useMutation` for writes; invalidate on success.
- Tailwind first, custom CSS only when Tailwind can't express it.
- UI primitives live in `components/ui.tsx` (Card, Button, Badge, Alert, Spinner). Add to that file rather than reinventing per-page.

## Env

- `VITE_API_URL` — absolute URL of the API (production). When unset, relative paths hit the Vite dev proxy.
- `VITE_DEV_API_PROXY` — dev-only proxy target, defaults to `http://localhost:3001`.
