# Admin Panel Access Guide

## URL

`https://app.grassion.com/admin` — the founder admin panel lives in the main web app.

## Authentication

Access is controlled by **GitHub numeric user ID** — not email, not password.

### Setup

1. Find your GitHub numeric ID:
   ```
   curl https://api.github.com/users/<your-github-login>
   # Look for: "id": 12345678
   ```

2. Add to your `.env` on the API server:
   ```
   ADMIN_GITHUB_IDS=12345678
   # Multiple admins (comma-separated):
   # ADMIN_GITHUB_IDS=12345678,87654321
   ```

3. Restart the API. Any GitHub user whose numeric ID is in that list will see the
   admin panel after logging in through the normal GitHub OAuth flow.

4. Non-admins hitting `/admin/*` routes are redirected to `/dashboard` silently.
   The API returns `404` (not `403`) to avoid advertising the existence of admin routes.

## Access log

Every request to `/api/admin/*` is recorded in the `admin_audit_log` table:
- `github_login`, `github_id`, `method`, `route`, `occurred_at`
- Visible in the **System → Admin access log** section of the admin panel.
- Never stores secrets, tokens, or hashes.

## Cloudflare Access (future hardening — not yet built)

For an extra layer of protection before the GitHub OAuth check:

1. In Cloudflare Zero Trust → Access → Applications, create an app for `app.grassion.com/admin*`
2. Add a policy: allow only your personal email or GitHub identity provider
3. This adds a Cloudflare JWT verification step before the request ever reaches Fly.io

Benefit: even if someone guesses or steals a valid Grassion session cookie, they can't
reach admin routes without passing Cloudflare Access first.

This is optional for a solo-founder tool but recommended once the product has paying customers.

## Supabase storage (for career resume downloads)

Add two env vars to the API:
```
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_KEY=<service-role-key>
```

Create a **private** bucket called `career-resumes` in Supabase Storage.
The API uploads resumes using the service key; signed URLs for admin download expire in 10 minutes.

## Env vars summary

| Var | Purpose | Required |
|-----|---------|----------|
| `ADMIN_GITHUB_IDS` | Comma-separated numeric GitHub user IDs granted admin access | Yes (admin panel disabled without it) |
| `SUPABASE_URL` | Supabase project URL | For resume storage |
| `SUPABASE_SERVICE_KEY` | Supabase service-role key | For resume storage |
