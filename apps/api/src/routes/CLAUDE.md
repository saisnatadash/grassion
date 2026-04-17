# apps/api/src/routes

REST handlers, grouped by resource. Each module exports a `Router` and is mounted in `routes/index.ts`.

| File | Mount | Auth |
|---|---|---|
| `auth.ts` | `/auth/*` | none for OAuth start/callback; `requireAuth` for `/auth/me` |
| `team.ts` | `/api/team*` | `requireAuth`; mutations require `owner` or `admin` |
| `repos.ts` | `/api/repos*` | `requireAuth`; toggle requires `owner`/`admin` |
| `metrics.ts` | `/api/metrics/*`, `/api/prs/*` | `requireAuth` |
| `billing.ts` | `/api/billing/*` | `requireAuth`; mutations require `owner`/`admin` |
| `contact.ts` | `/api/contact` | none (rate-limited 10/hr/IP, honeypot field, 5KB body cap) |

## Patterns

- Validate request bodies with Zod schemas from `@grassion/shared` — return 400 on parse failure.
- Always scope queries by `req.session!.teamId`. Never trust an `id` from the client without an owning-team check.
- Return ISO date strings, never raw `Date` objects.
- 401 = no session; 403 = wrong role; 404 = not found in this team.

## Razorpay billing flow

1. `POST /api/billing/subscribe` — creates a Razorpay subscription, persists the id, returns `{subscriptionId, razorpayKey, planId, seatCount}` for the JS SDK.
2. Frontend opens Razorpay Checkout with that subscription id.
3. After payment, the SDK calls our `handler` with `{razorpay_payment_id, razorpay_subscription_id, razorpay_signature}`.
4. `POST /api/billing/verify` re-verifies the signature server-side and refreshes the subscription state from Razorpay.
5. The webhook (`/webhooks/razorpay`) then catches up async with the canonical state.

## Contact form

`POST /api/contact` sends two emails via Zoho SMTP: one to `ZOHO_TO_ADDRESS` (you), and an auto-reply to the sender. The honeypot field is `website` — bots usually fill every field, so any non-empty value silently 200s without sending. SMTP credentials are Zoho app-specific passwords, never the main account password.
