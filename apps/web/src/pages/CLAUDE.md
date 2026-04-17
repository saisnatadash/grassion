# apps/web/src/pages

Top-level routed pages. One file per page. Each is mounted from `App.tsx`.

Pages own their data fetching (via `useQuery`) and orchestrate primitives from `components/ui.tsx`. They should not contain ad-hoc utility components — extract those to `components/` if reused, or leave them as small inline functions inside the page if not.

Authenticated pages render inside `<AppLayout />`, so they can assume the user has a session by the time they mount.
