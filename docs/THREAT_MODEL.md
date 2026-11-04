# Grassion — Threat Model

> Last updated: 2026-11-05

---

## 1. What Grassion Holds

| Asset | Where stored | Sensitivity |
|-------|-------------|-------------|
| **GitHub App private key** | Fly.io secret → process env | **Critical** — allows signing JWT tokens for any GitHub API call as the App |
| **GitHub App client secret** | Fly.io secret → process env | **Critical** — allows OAuth impersonation |
| **GitHub OAuth tokens** (per-team) | `teams.githubOauthToken` (encrypted AES-256-GCM) | **High** — scopes: `repo`, `read:org`, `read:user`; allows reading private repo metadata |
| **GitHub installation tokens** | Ephemeral; never persisted | **High** — cached in memory by `@octokit/auth-app` for ≤1 hour |
| **JWT session tokens** | HTTP-only cookie + `sessions.tokenHash` (SHA-256) | **High** — grants full user session |
| **MCP API tokens** | `mcpApiTokens.tokenHash` (SHA-256); raw shown once | **High** — grants read access to HC data via MCP |
| **HC share tokens** | `hcShareTokens.token` (plaintext, 14-day expiry) | **Medium** — read-only public share of Dark Code report |
| **Customer PR/review metadata** | `pullRequests`, `hcEvidence`, `hcCoverageAreas` tables | **Medium** — PR titles, merge times, filenames, author logins; no diff content |
| **File paths** | `hcCoverageAreas.path`, `rfgPrFilePaths.filePath` | **Low-Medium** — reveals internal codebase structure |
| **User emails** | `users.email` | **Medium** — PII; obtained via GitHub OAuth |
| **Payment records** | `subscriptions`, `razorpayOrders` tables | **Medium** — plan, amount, timestamps; no raw card data (Razorpay-side) |
| **Career resumes** | Supabase private bucket (server-side signed URLs) | **High** — PII; résumés and cover letters |
| **Contact form messages** | `contactSubmissions` table | **Low-Medium** — name, email, free-text |
| **Analytics events** | `analyticsEvents` table | **Low** — page views, click events, session IDs |
| **Admin audit log** | `adminAuditLog` table | **Internal** — admin actions |
| **Razorpay secret / webhook secret** | Fly.io secret → process env | **High** — financial integrity |
| **SMTP password (Zoho)** | Fly.io secret → process env | **High** — allows sending email as grassion.com |
| **OpenAI API key** | Fly.io secret → process env | **High** — financial; allows LLM calls billed to Grassion |

---

## 2. Trust Boundaries

```
Internet
  │
  ├─── GitHub (webhooks, OAuth, API)       trusted provider, verify HMAC + JWT
  ├─── Razorpay (webhooks, API)             trusted provider, verify HMAC
  ├─── Zoho SMTP                           trusted provider, authenticated
  │
  ▼
[Fly.io — grassion-api]  ←→  [Neon Postgres]
         ↑                        ↑
  Authenticated users       [Fly.io — grassion-worker]
  (session JWT cookie)
         ↑
  [apps/web — React SPA]  (Vite bundle, no secrets)
  [apps/marketing — Astro] (static, no secrets)
         ↑
  Unauthenticated visitors (contact form, marketing)
```

---

## 3. Attackers

### 3.1 Outside Attacker (unauthenticated)

**Goals:** extract user data, pivot to customer repos, disrupt service, steal payment secrets.

| Risk | Asset at risk | Vector |
|------|--------------|--------|
| Webhook spoofing | PR/installation events | POST `/api/webhooks/github` without valid HMAC-SHA256 |
| Brute-force admin | All admin data | `/api/admin/*` without valid GitHub numeric ID in `ADMIN_GITHUB_IDS` |
| Contact-form abuse / spam | SMTP quota, inbox | POST `/api/contact` without rate-limit bypass |
| HC share-token enumeration | Dark Code report | Guess 32-char random tokens (negligible at 2^256 search space) |
| Dependency supply-chain | Full process | Malicious npm package executing in API/worker process |
| Secret leakage via logs | Tokens, emails | Log aggregator (Fly.io structured logs) capturing redacted fields |

### 3.2 Malicious Customer (authenticated, non-admin)

**Goals:** read another team's data, bypass plan limits, escalate to admin.

| Risk | Asset at risk | Vector |
|------|--------------|--------|
| Cross-team data read | PR data, HC coverage | Use own JWT to query `/api/analytics?teamId=other` without server-side `teamId` check |
| Plan-gate bypass | Pro features (HC, share tokens, MCP) | Call Pro endpoints with a free-plan session |
| Admin escalation | All admin data | Call `/api/admin/*` — blocked by `requireSuperAdmin` (GitHub numeric ID check) |
| OAuth token theft | `teams.githubOauthToken` | XSS → steal session cookie → call API → token is encrypted at rest, still usable via API |
| HC share token abuse | Dark Code report | Share tokens are scoped per-repo and expire after 14 days |
| Resume exfiltration | Career applicant PII | Signed URLs are 10-minute expiry; require admin session to generate |

### 3.3 Compromised Dependency

**Goals:** exfiltrate secrets from the running process.

| Risk | Asset at risk | Vector |
|------|--------------|--------|
| Env var exfiltration | All Fly.io secrets | Malicious package reads `process.env.*` at startup |
| DB credential abuse | Entire database | Malicious package runs arbitrary SQL via `DATABASE_URL` |
| GitHub App private key abuse | Full GitHub App access | Package reads `GITHUB_APP_PRIVATE_KEY` from env |
| SSRF via fetch | Internal Fly.io network | Malicious package crafts `fetch()` calls to internal metadata endpoints |

**Mitigations:** `pnpm audit`, lockfile pinning, Dependabot, restricted Fly.io network egress.

### 3.4 Insider (developer with Fly.io access)

**Goals:** access customer data, modify billing, exfiltrate secrets.

| Risk | Asset at risk | Vector |
|------|--------------|--------|
| `fly ssh console` | Live DB credentials, env secrets | Direct shell access to running container |
| `fly secrets list` | Secret names (not values) | Secret names are visible; values require `fly ssh` |
| Neon direct access | All customer data | If DATABASE_URL is known, direct psql access |
| Git history secrets | Rotated secrets | Secrets in historical commits (see `docs/ROTATE_SECRETS.md`) |

---

## 4. Top Risks by Asset

| Asset | Top risk | Mitigations in place |
|-------|---------|----------------------|
| GitHub App private key | Leaked via git history / log | Rotate immediately (see ROTATE_SECRETS.md); never log env vars; redaction in logger |
| GitHub OAuth tokens | Plaintext at rest → DB dump reads all tokens | AES-256-GCM encryption (`TOKEN_ENCRYPTION_KEY`) |
| Installation tokens | In-memory only; short-lived | Never persisted; `@octokit/auth-app` manages cache |
| JWT session tokens | Cookie theft → full account access | HTTP-only, Secure, SameSite=Lax; server validates `tokenHash` on every request |
| HC share tokens | Enumeration (impractical); accidental exposure | 32-char random; 14-day expiry; plan-gated creation |
| Customer PR metadata | Cross-team query | Every API query filters by `sess.teamId`; no raw diffs stored |
| Career resumes | Bucket misconfiguration | Private Supabase bucket; signed URLs (10 min TTL); admin-only endpoint |
| Razorpay secret | Webhook replay | HMAC-SHA256 verify on every webhook; `razorpay_payment_id` idempotency |
| SMTP password | Credential stuffing → email spoofing | App-specific password; Zoho 2FA on the account |
| Secrets in git history | Repo clone reveals old values | See `docs/ROTATE_SECRETS.md` — all exposed secrets must be rotated |

---

## 5. Out of Scope (v1)

- DDoS / volumetric attacks — handled at Fly.io edge / Cloudflare level
- Physical access to Fly.io datacenters
- GitHub itself being compromised
- Razorpay infrastructure compromise
- End-user device compromise
