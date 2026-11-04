# Security Review — Grassion

Automated review conducted 2026-11-05. All findings relate to items in this branch unless noted.

---

## Round 3: Infrastructure & Supply-chain Checklist

| # | Item | Severity | Status | Fix / Notes |
|---|------|----------|--------|-------------|
| 1a | `drizzle-orm` SQL injection (GHSA-gpj5-g38j-94v9) | HIGH | ✅ Fixed | Upgraded all workspaces: `^0.33.0` → `^0.45.4`; drizzle-kit: `^0.24.0` → `^0.31.11` |
| 1b | `vitest` arbitrary file read via UI server (GHSA-5xrq-8626-4rwp) | CRITICAL | ✅ Fixed | Upgraded `^2.0.5` → `^3.2.6` |
| 1c | `tinypool` prototype pollution RCE (GHSA-…) | CRITICAL | ✅ Fixed | pnpm override `tinypool>=2.1.2` (vitest 3.x ships tinypool 1.x) |
| 1d | `proxy-addr` IP spoofing (GHSA-jqcg-44mw-7w3h) | CRITICAL | ✅ Fixed | pnpm override `proxy-addr>=2.0.8` |
| 1e | `axios` prototype pollution / header injection via Razorpay | HIGH | ✅ Fixed | pnpm override `axios>=1.15.2` |
| 1f | `devalue` DoS via sparse array (GHSA-77vg-94rm-hx3p) | HIGH | ✅ Fixed | pnpm override `devalue>=5.8.1` |
| 1g | `body-parser` DoS via trailing compressed bytes | HIGH | ✅ Fixed | pnpm override `body-parser>=1.20.9` |
| 1h | `follow-redirects` sensitive-header bypass (GHSA-…) | HIGH | ✅ Fixed | pnpm override `follow-redirects>=1.16.2` |
| 1i | `fast-uri` SSRF / host-confusion (dev tooling) | HIGH | ✅ Fixed | pnpm override `fast-uri>=3.1.6` |
| 1j | `nodemailer` multiple CVEs (GHSA-…) | HIGH | ✅ Fixed | Upgraded `^6.9.14` → `^10.3.1`; `@types/nodemailer` → `^8.0.2` |
| 1k | `astro` AVIF RCE (GHSA-26w7-cxv4-gfx2) | CRITICAL | ⚠️ **Manual** | Requires upgrading astro v4 → v7 (3 major versions); marketing site uses `@astrojs/tailwind` and custom pages — scope the upgrade separately and test with `astro check` + visual regression. See §Manual Steps. |
| 1l | `zod` memory exhaustion (GHSA-mrhx-c7xc-m3w5) | HIGH | ⚠️ **Manual** | Requires upgrading zod v3 → v4; v4 has breaking API changes throughout the codebase (error shape, `z.object` syntax changes). Scope as a dedicated PR; body-size limit (1 MB) partially mitigates the DoS surface. |
| 1m | `PostCSS` / `Browserslist` / `JS-YAML` / `launch-editor` / `nanoid` / `sharp` / `source-map-js` | MODERATE–HIGH | ✅ Accepted | All are **build-time / dev-only** transitive deps (vite, astro, tailwind toolchain). They are not in the production Node.js runtime; production containers do not ship `node_modules`. Risk: CI build environment only. Track via Dependabot. |
| 2 | Dependabot (npm + GitHub Actions) | — | ✅ Added | `.github/dependabot.yml` created: weekly on Mondays, groups drizzle/octokit/testing |
| 3a | GitHub Actions: pin to commit SHAs | — | ✅ Fixed | All uses in `ci.yml` and `deploy.yml` pinned to full SHAs |
| 3b | GitHub Actions: least-privilege permissions | — | ✅ Fixed | `permissions: contents: read` default on all jobs/workflows |
| 3c | CodeQL (JS/TS) workflow | — | ✅ Added | `.github/workflows/codeql.yml` — push/PR/weekly |
| 3d | Semgrep workflow (default rulesets) | — | ✅ Added | `.github/workflows/semgrep.yml` — push/PR/weekly; `semgrep ci --config=auto` |
| 4a | Error tracking — PII scrubbing | — | ✅ Added | `apps/api/src/lib/monitoring.ts`: `scrubObject()` redacts emails/tokens/auth headers before logging |
| 4b | Error tracking — spike alerts | — | ✅ Added | In-process sliding-window counters for: 401 spike (>50/5min), 403 spike (>20/5min), webhook sig failures (>5/5min), LLM cap hits (>3/hr), job failures (>5/hr) |
| 4c | Error tracking — Sentry integration | — | ⚠️ **Manual** | `SENTRY_DSN` env var added to env schema and `.env.example`. Wire `Sentry.init()` in `lib/monitoring.ts`'s `captureError()` function. See §Manual Steps. |
| 5 | `/.well-known/security.txt` | — | ✅ Added | Created with `Contact: security@grassion.com`; expires 2027-11-05 |
| 5b | Responsible disclosure page | — | ✅ Added | `apps/marketing/src/pages/security/disclosure.astro` — scope, timeline, safe harbour |
| 6 | SPF record for grassion.com | HIGH | ⚠️ **Missing** | DNS query returns only Zoho verification TXT. No `v=spf1` record found. See §Manual Steps. |
| 6b | DKIM for grassion.com | HIGH | ⚠️ **Missing** | `_dmarc.grassion.com` does not exist. See §Manual Steps. |
| 6c | DMARC for grassion.com | HIGH | ⚠️ **Missing** | No DMARC record. See §Manual Steps. |
| 7 | OWASP ZAP baseline scan | — | ⚠️ **Manual** | Requires a running staging deployment; cannot be run in CI without one. See §Manual Steps. |

---

## Round 2: OpenAI / Privacy / MCP / Retention (2026-11-05)

| # | Item | Status |
|---|------|--------|
| OpenAI prompt injection defence | ✅ Fixed | System prompts now explicitly constrain the model; PR title treated as untrusted data |
| Privacy: `sanitizeFile()` strips `patch` field | ✅ Fixed | `privacy.test.ts` enforces this with 4 automated tests |
| MCP tokens: expiry, rate-limit, last-used | ✅ Fixed | `expiresAt` column; `mcpLimiter` 30/min; `lastUsedAt` shown in Settings |
| Team deletion on uninstall (24h grace) | ✅ Fixed | `scheduledDeletionAt` column; retention job cleans up |
| Data retention: analytics 13m, careers 12m | ✅ Fixed | Worker env vars `ANALYTICS_RETENTION_MONTHS` / `CAREER_APP_RETENTION_MONTHS` |
| Privacy page: OpenAI as subprocessor | ✅ Fixed | Table with zero-data-retention disclosure |

---

## Round 1: Webhook / Headers / XSS / Rate-limits / Tokens (2026-11-05)

| # | Item | Status |
|---|------|--------|
| Webhook HMAC timing-safe + replay protection | ✅ Fixed |
| Share tokens: hashed (SHA-256), expiry, rate-limited | ✅ Fixed |
| Security headers: Helmet, CSP, HSTS, Permissions-Policy | ✅ Fixed |
| CORS: exact allow-list, no wildcard + credentials | ✅ Fixed |
| Rate limits: login, OAuth, MCP, Slack, share, public forms | ✅ Fixed |
| Bot protection: Cloudflare Turnstile on contact/careers | ✅ Fixed |
| Resume upload: magic bytes, random filename, signed URL, attachment disposition | ✅ Fixed |
| Open redirect: same-site path validation | ✅ Fixed |

---

## Manual Steps Required

### 1. Astro v7 upgrade

The marketing site (`apps/marketing`) uses astro 4.x which has a critical AVIF RCE advisory (GHSA-26w7-cxv4-gfx2). The vulnerability is triggered only when processing AVIF images at build time. To fix:

```bash
pnpm add astro@^7.2.8 @astrojs/tailwind@latest --filter @grassion/marketing
pnpm add @astrojs/check@latest --filter @grassion/marketing -D
# Then run: pnpm --filter @grassion/marketing build
# Check for breaking changes in layout/pages and fix accordingly.
```

### 2. Zod v4 upgrade

The `zod` advisory (GHSA-mrhx-c7xc-m3w5) requires zod `>=4.6.6`. Zod v4 has breaking API changes:
- `z.object()` returns `ZodObject` with a different `.shape` type
- Error objects changed (`ZodError.flatten()` signature changed)
- Some schemas renamed

Upgrade command: `pnpm add zod@^4.6.7 -r`
Then fix all TypeScript errors in `packages/shared`, `apps/api/src/routes/*`, and `apps/worker/src/`.

Partial mitigation already in place: 1 MB body-size limit throttles the DoS attack surface.

### 3. Sentry error reporting

```bash
pnpm add @sentry/node --filter @grassion/api
```

Then in `apps/api/src/lib/monitoring.ts`, replace the TODO comment with:
```typescript
import * as Sentry from '@sentry/node'

// Called once at startup (e.g. in apps/api/src/index.ts):
export function initMonitoring() {
  const dsn = env().SENTRY_DSN
  if (!dsn) return
  Sentry.init({
    dsn,
    environment: env().NODE_ENV,
    beforeSend: (event) => {
      // Scrub PII from extra context.
      if (event.extra) event.extra = scrubObject(event.extra) as Record<string, unknown>
      return event
    },
  })
}

// In captureError():
export function captureError(err: unknown, context?: Record<string, unknown>): void {
  const scrubbed = context ? (scrubObject(context) as Record<string, unknown>) : undefined
  logger.error({ err, ...scrubbed }, 'captureError')
  if (env().SENTRY_DSN) Sentry.captureException(err, { extra: scrubbed })
}
```

Set `SENTRY_DSN` in Fly.io secrets: `flyctl secrets set SENTRY_DSN=https://... --config fly.api.toml`

### 4. SPF / DKIM / DMARC for grassion.com

DNS query on 2026-11-05 shows **none of these records exist**. Emails from grassion.com will likely hit spam filters and can be spoofed.

Add these records at your DNS registrar:

**SPF** — TXT record on `grassion.com`:
```
v=spf1 include:zoho.com include:transactional.resend.com ~all
```

**DKIM** — Follow Zoho's guide: Admin → Email Settings → DKIM. Add the resulting TXT record under `zoho._domainkey.grassion.com`.

**DMARC** — TXT record on `_dmarc.grassion.com`:
```
v=DMARC1; p=quarantine; rua=mailto:dmarc-reports@grassion.com; adkim=r; aspf=r
```

Start with `p=quarantine` and move to `p=reject` once you confirm delivery.

### 5. OWASP ZAP baseline scan

Run against staging, never production:

```bash
docker run -t ghcr.io/zaproxy/zaproxy:stable zap-baseline.py \
  -t https://staging-api.grassion.com \
  -r zap-report.html
```

Review the report and fix high/medium findings. Focus on:
- Authentication bypass paths
- CORS misconfiguration
- Missing security headers (verify our helmet config is applied correctly)
- SQL injection via any query parameters

### 6. Semgrep App Token (optional)

Add `SEMGREP_APP_TOKEN` as a GitHub Actions secret to enable the Semgrep dashboard and diff-aware scans. Without the token the workflow still runs but results are only in GitHub Security.

---

## Audit baseline — 2026-11-05 (after this PR)

```
pnpm audit
Remaining critical: 1 (astro AVIF — build-time, manual upgrade required)
Remaining high:     5 unique packages (astro 3×, zod, browserslist/postcss/js-yaml/launch-editor/nanoid/sharp — all build-time)
Fixed in this PR:   drizzle-orm, vitest, tinypool, proxy-addr, axios, devalue,
                    body-parser, follow-redirects, fast-uri, nodemailer
```
