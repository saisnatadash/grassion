# apps/web/src/lib

Non-React utilities.

- `api.ts` — typed fetch client. Every endpoint goes through `request()`. Adds `credentials: 'include'`. Throws `ApiError` (with status) on failure so React Query can branch on `error.status === 401`.
- `utils.ts` — `cn(...)` (tailwind-merge), `formatUsd(n)`.

If you need to call the API from a component, import from `api.ts` — don't `fetch` directly.
