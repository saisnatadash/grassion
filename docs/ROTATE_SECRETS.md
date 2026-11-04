# Grassion — Secret Rotation Guide

> **Do NOT rotate anything using this guide directly.** This document is a reference only.
> Each section lists the secret, where it lives, and where to generate a replacement.

---

## GitHub OAuth App secrets

| Secret | Purpose | Where to rotate |
|--------|---------|-----------------|
| `GITHUB_APP_CLIENT_SECRET` | GitHub OAuth login | [GitHub App settings](https://github.com/settings/apps) → your app → "Client secrets" → Regenerate |
| `GITHUB_APP_PRIVATE_KEY` | GitHub App JWT signing (webhooks/API calls) | Same app settings → "Private keys" → Generate new, delete old |
| `GITHUB_APP_WEBHOOK_SECRET` | Verifies incoming GitHub webhook HMAC | Same app → "Webhook" → update secret → update env var in Fly.io |

## JWT / Session

| Secret | Purpose | Where to rotate |
|--------|---------|-----------------|
| `JWT_SECRET` | Signs session JWTs (must be 32+ chars) | Generate locally: `openssl rand -base64 48` → update Fly.io secret → restart API |
| *Note* | Rotating JWT_SECRET immediately invalidates all active sessions — users must log in again. | — |

## Database

| Secret | Purpose | Where to rotate |
|--------|---------|-----------------|
| `DATABASE_URL` | Neon Postgres connection string (includes password) | [Neon console](https://console.neon.tech) → project → Connection → Reset password |
| *Note* | Update in Fly.io secrets for both `api` and `worker` machines after rotating. | — |

## Razorpay billing

| Secret | Purpose | Where to rotate |
|--------|---------|-----------------|
| `RAZORPAY_KEY_SECRET` | Razorpay API secret key | [Razorpay dashboard](https://dashboard.razorpay.com) → Settings → API Keys → Regenerate |
| `RAZORPAY_WEBHOOK_SECRET` | Verifies Razorpay webhook HMAC | Razorpay dashboard → Webhooks → edit → regenerate secret |
| *Note* | Update `RAZORPAY_KEY_ID` too if regenerating the full key pair. | — |

## OpenAI

| Secret | Purpose | Where to rotate |
|--------|---------|-----------------|
| `OPENAI_API_KEY` | PR summary generation | [OpenAI platform](https://platform.openai.com/api-keys) → Create new key → delete old |

## Email (Zoho SMTP)

| Secret | Purpose | Where to rotate |
|--------|---------|-----------------|
| `ZOHO_SMTP_PASS` | SMTP authentication for digest emails | Zoho Mail → Settings → Security → App Passwords → revoke + create new |

## Resend (optional)

| Secret | Purpose | Where to rotate |
|--------|---------|-----------------|
| `RESEND_API_KEY` | Transactional email fallback | [Resend dashboard](https://resend.com/api-keys) → Create new key → delete old |

## Slack

| Secret | Purpose | Where to rotate |
|--------|---------|-----------------|
| `SLACK_SIGNING_SECRET` | Verifies Slack slash-command payloads | [Slack app settings](https://api.slack.com/apps) → Basic Information → Signing Secret → Regenerate |

## Admin / Internal

| Secret | Purpose | Where to rotate |
|--------|---------|-----------------|
| `ADMIN_SECRET` | Protects `/api/admin/*` endpoints | Generate locally: `openssl rand -base64 32` → update Fly.io secret |

---

## Rotating in Fly.io

```bash
# Single secret
fly secrets set SECRET_NAME=new_value --app grassion-api

# Multiple at once
fly secrets set KEY1=val1 KEY2=val2 --app grassion-api

# Confirm and trigger redeploy
fly deploy --app grassion-api
```

After rotating any secret, restart both `grassion-api` and `grassion-worker` apps.

---

## After rotation checklist

- [ ] Update the secret in Fly.io (both `api` and `worker` if shared)
- [ ] Trigger a deploy to pick up the new value
- [ ] Delete the old secret/key from the provider dashboard
- [ ] Verify the app starts and health check passes (`/health`)
- [ ] Test the affected feature end-to-end (e.g. login after JWT_SECRET rotation)
