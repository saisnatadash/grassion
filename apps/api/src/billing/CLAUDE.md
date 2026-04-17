# apps/api/src/billing

Razorpay SDK singleton + signature helpers.

- `razorpay()` — lazy-initialized Razorpay client. Don't instantiate `new Razorpay(...)` anywhere else.
- `createSubscription(...)` — creates a Razorpay subscription with `total_count: 120` (10-year cap, not commitment) and a `team_id` note for webhook lookups.
- `verifyWebhookSignature(rawBody, header)` — HMAC-SHA256 with `RAZORPAY_WEBHOOK_SECRET`, constant-time compare.
- `verifyCheckoutSignature({ razorpayPaymentId, razorpaySubscriptionId, razorpaySignature })` — used by `/api/billing/verify` after the JS SDK returns from Checkout.

Stripe was removed in v2 (SPEC2.md) — Razorpay is the primary processor for v1 because most early customers will be in India and Razorpay supports both INR and international cards.
