# Grassion — Complete MVP Build Spec v2

**Changes from v1:** Razorpay replaces Stripe for v1 · OpenAI added for PR risk summaries · Zoho mail for inbox + contact auto-reply · Full marketing site (landing, about, contact, pricing, privacy, terms) included · All copy provided.

---

## 0. Summary of What's Different From v1 Spec

If Claude Code already scaffolded based on v1, here are the deltas to apply:

| Area | v1 (old) | v2 (new) |
|---|---|---|
| Payments | Stripe only | Razorpay primary, Stripe deferred to month 3 |
| Email sending | Resend | Resend (no change) |
| Email receiving | Not defined | Zoho mail at hello@, support@, contact@ |
| LLM | None in v1 | OpenAI GPT-4o-mini for PR risk summaries (1 feature) |
| Marketing site | Minimal | Full: home, about, pricing, contact, privacy, terms, blog-ready |
| Env vars | Stripe keys | Razorpay keys + OPENAI_API_KEY + ZOHO_SMTP (for contact form reply only) |

Tell Claude Code: *"Apply v2 deltas: swap Stripe → Razorpay, add OpenAI for PR summaries, build full marketing site with pages below, add Zoho SMTP for contact-form auto-reply."*

---

## 1. Repository Structure (Updated)

```
grassion/
├── apps/
│   ├── api/              # Express backend — webhooks, REST API, auth, AI summaries
│   ├── web/              # React + Vite — dashboard, settings, billing (app.grassion.com)
│   ├── marketing/        # Next.js OR Astro — marketing site (grassion.com)
│   └── worker/           # Node cron — outcome tracker, weekly email, LLM summaries
├── packages/
│   ├── db/               # Drizzle schema + migrations
│   └── shared/           # Shared types
├── fly.api.toml
├── fly.worker.toml
└── ...
```

**Marketing site tech choice:** Use **Astro** for the marketing site. Why Astro over Next.js: it's faster to build, ships as static HTML (perfect SEO, near-zero hosting cost), and you can deploy to Vercel/Cloudflare Pages free. Next.js is overkill for a 6-page marketing site.

---

## 2. Updated Environment Variables

```bash
# Database (unchanged)
DATABASE_URL=...

# GitHub App (unchanged)
GITHUB_APP_ID=...
GITHUB_APP_PRIVATE_KEY=...
GITHUB_APP_CLIENT_ID=...
GITHUB_APP_CLIENT_SECRET=...
GITHUB_APP_WEBHOOK_SECRET=...

# Razorpay (NEW - replaces Stripe)
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=...
RAZORPAY_WEBHOOK_SECRET=...
RAZORPAY_PLAN_ID_STARTER=plan_...   # create this in Razorpay dashboard

# OpenAI (NEW - for PR risk summaries only)
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini             # cheap + fast
OPENAI_MONTHLY_BUDGET_USD=10         # hard cap, code respects this

# Email sending (unchanged)
RESEND_API_KEY=re_...
EMAIL_FROM="Grassion <hello@grassion.com>"

# Zoho SMTP (NEW - for contact form auto-reply ONLY, not transactional)
ZOHO_SMTP_HOST=smtp.zoho.in
ZOHO_SMTP_PORT=587
ZOHO_SMTP_USER=contact@grassion.com
ZOHO_SMTP_PASS=...                   # app-specific password, not main password
ZOHO_FROM_ADDRESS=contact@grassion.com

# Auth
JWT_SECRET=...
SESSION_COOKIE_DOMAIN=.grassion.com

# URLs
MARKETING_URL=https://grassion.com
APP_URL=https://app.grassion.com
API_URL=https://api.grassion.com

# Node
NODE_ENV=development
PORT=3001
LOG_LEVEL=info
```

---

## 3. Razorpay Integration (Replaces Stripe)

### Setup
1. Sign up at razorpay.com → complete KYC (takes 1-2 days, start NOW)
2. Products → Subscriptions → Create Plan:
   - **Grassion Starter** — ₹2,400/user/month (≈ $29, adjust monthly)
   - Interval: Monthly, billing cycle: 1 month
3. Copy Plan ID → `RAZORPAY_PLAN_ID_STARTER`
4. Settings → API keys → generate test keys
5. Webhooks → create endpoint: `https://api.grassion.com/webhooks/razorpay`
   - Events: `subscription.activated`, `subscription.charged`, `subscription.cancelled`, `subscription.pending`, `subscription.halted`, `payment.failed`
   - Copy signing secret → `RAZORPAY_WEBHOOK_SECRET`

### Pricing strategy (dual currency)

For v1: show INR to Indian visitors (geolocation), USD to others. Single price plan in Razorpay (INR). For USD customers, Razorpay supports international cards — it'll charge the INR amount converted by Visa/MC. This is fine for first 20 customers.

| Plan | INR | USD equivalent |
|---|---|---|
| Starter (5-10 devs) | ₹2,400/dev/mo | ~$29/dev/mo |
| Team (10-30 devs) | ₹1,600/dev/mo (min 10) | ~$19/dev/mo |
| Business (30-50 devs) | ₹41,000 flat | ~$499 flat |

### Razorpay code — create subscription

File: `apps/api/src/billing/razorpay.ts`

```typescript
import Razorpay from 'razorpay'
import crypto from 'crypto'

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID!,
  key_secret: process.env.RAZORPAY_KEY_SECRET!,
})

export async function createSubscription(params: {
  planId: string
  customerEmail: string
  customerName: string
  teamId: string
  quantity: number
}) {
  const subscription = await razorpay.subscriptions.create({
    plan_id: params.planId,
    total_count: 120, // 10 years max (Razorpay requirement)
    quantity: params.quantity,
    notes: { team_id: params.teamId },
    notify_info: {
      notify_email: params.customerEmail,
    },
  })
  return subscription
}

export function verifyWebhookSignature(body: string, signature: string): boolean {
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET!)
    .update(body)
    .digest('hex')
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
}
```

### Frontend — Razorpay Checkout

Razorpay uses a JS SDK, not redirect checkout. In `apps/web/src/pages/Billing.tsx`:

```typescript
declare global { interface Window { Razorpay: any } }

async function startCheckout(seats: number) {
  // 1. Call backend to create subscription
  const { subscriptionId, razorpayKey } = await api.post('/api/billing/subscribe', { seats })
  
  // 2. Load Razorpay checkout SDK
  const options = {
    key: razorpayKey,
    subscription_id: subscriptionId,
    name: 'Grassion',
    description: `Starter plan · ${seats} developers`,
    image: 'https://grassion.com/logo.png',
    handler: async (response: any) => {
      // Verify signature on backend, then redirect
      await api.post('/api/billing/verify', response)
      window.location.href = '/app/dashboard?subscribed=1'
    },
    prefill: { email: currentUser.email },
    theme: { color: '#0F172A' },
  }
  const rzp = new window.Razorpay(options)
  rzp.open()
}
```

In `index.html`, add: `<script src="https://checkout.razorpay.com/v1/checkout.js"></script>`

### Webhook handler

File: `apps/api/src/webhooks/razorpay.ts`

```typescript
app.post('/webhooks/razorpay', express.raw({ type: 'application/json' }), async (req, res) => {
  const signature = req.headers['x-razorpay-signature'] as string
  const bodyStr = req.body.toString('utf8')
  
  if (!verifyWebhookSignature(bodyStr, signature)) {
    return res.status(400).send('Invalid signature')
  }
  
  const event = JSON.parse(bodyStr)
  
  switch (event.event) {
    case 'subscription.activated':
      await activateTeamSubscription(event.payload.subscription.entity)
      break
    case 'subscription.charged':
      await recordPayment(event.payload.payment.entity)
      break
    case 'subscription.cancelled':
    case 'subscription.halted':
      await deactivateTeamSubscription(event.payload.subscription.entity)
      break
    case 'payment.failed':
      await notifyPaymentFailure(event.payload.payment.entity)
      break
  }
  
  res.status(200).send('ok')
})
```

---

## 4. OpenAI Integration — PR Risk Summaries

**What it does:** In the weekly email + dashboard "Problem PRs" list, instead of a cryptic "reverted in 3 days," we show a plain-English one-liner like: *"Added retry logic to payment gateway; reverted after causing duplicate charges on 12 orders."*

**Where used (only):** Weekly digest generator + dashboard "Problem PRs" fetch.

**Not used for:** Detection (regex handles it), chat UI (no chat in v1), code analysis (no code leaves GitHub).

### Code

File: `apps/worker/src/llm/pr-summary.ts`

```typescript
import OpenAI from 'openai'
import { db } from '@grassion/db'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
const MODEL = process.env.OPENAI_MODEL ?? 'gpt-4o-mini'
const MONTHLY_BUDGET = parseFloat(process.env.OPENAI_MONTHLY_BUDGET_USD ?? '10')

export async function summarizeProblemPR(pr: {
  title: string
  authorLogin: string
  additions: number
  deletions: number
  outcome: {
    wasReverted: boolean
    downstreamFixCount: number
    ciFailureCount: number
    hadHotfixWithin7d: boolean
  }
}): Promise<string> {
  // Budget guard — skip if we've spent too much this month
  if (await isBudgetExceeded()) {
    return fallbackSummary(pr) // deterministic string fallback
  }

  const prompt = `You are a senior engineer writing a 1-sentence, factual summary of why a pull request is flagged as problematic.

PR title: "${pr.title}"
Changes: +${pr.additions}/-${pr.deletions} lines
Signals:
- Reverted: ${pr.outcome.wasReverted}
- Downstream fix PRs: ${pr.outcome.downstreamFixCount}
- CI failures: ${pr.outcome.ciFailureCount}
- Hotfix within 7 days: ${pr.outcome.hadHotfixWithin7d}

Write ONE sentence, max 20 words, factual, no speculation. Example: "Added retry logic to payment gateway; reverted after 2 downstream fixes." Do not invent details not supported by signals.`

  const res = await openai.chat.completions.create({
    model: MODEL,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 60,
    temperature: 0.3,
  })
  
  const summary = res.choices[0]?.message?.content?.trim() ?? fallbackSummary(pr)
  await recordUsage(res.usage?.total_tokens ?? 0)
  return summary
}

function fallbackSummary(pr: any): string {
  const parts = []
  if (pr.outcome.wasReverted) parts.push('reverted after merge')
  if (pr.outcome.downstreamFixCount > 0) parts.push(`${pr.outcome.downstreamFixCount} follow-up fix(es)`)
  if (pr.outcome.hadHotfixWithin7d) parts.push('hotfix within 7 days')
  if (pr.outcome.ciFailureCount > 2) parts.push(`${pr.outcome.ciFailureCount} CI failures`)
  return parts.length > 0
    ? `${pr.title} — ${parts.join(', ')}.`
    : `${pr.title} — flagged for review.`
}

async function isBudgetExceeded(): Promise<boolean> {
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  const usage = await db.query.llmUsageLog.findMany({
    where: gte(llmUsageLog.createdAt, monthStart),
  })
  const costUsd = usage.reduce((sum, u) => sum + (u.estimatedCostUsd ?? 0), 0)
  return costUsd >= MONTHLY_BUDGET
}

async function recordUsage(tokens: number) {
  // GPT-4o-mini: $0.15/1M input, $0.60/1M output. Rough $0.375/1M blended.
  const costUsd = (tokens / 1_000_000) * 0.375
  await db.insert(llmUsageLog).values({ tokens, estimatedCostUsd: costUsd })
}
```

### Add to schema (`packages/db/src/schema.ts`)

```typescript
export const llmUsageLog = pgTable('llm_usage_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  tokens: integer('tokens').notNull(),
  estimatedCostUsd: real('estimated_cost_usd').notNull(),
  purpose: text('purpose').default('pr_summary'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})
```

### Use in weekly email + dashboard

In weekly email generator, for each problem PR call `summarizeProblemPR()` and put the result as the `reason` field. Cache the summary in `pr_outcomes.ai_summary` (add this column) so we don't regenerate on every dashboard load.

Add column:
```typescript
// in pr_outcomes table
aiSummary: text('ai_summary'),
aiSummaryGeneratedAt: timestamp('ai_summary_generated_at'),
```

**Cost projection:** 30 teams × 10 problem PRs/week × $0.375/1M × ~500 tokens = $0.056/month total. Your ₹2K OpenAI credit covers 4+ years at this scale.

---

## 5. Zoho Mail Setup

### Mail domain setup (one-time, 30 minutes)
1. Log into Zoho Mail admin → add grassion.com domain
2. Verify via DNS TXT record (add in Cloudflare)
3. Add MX records per Zoho instructions
4. Add SPF, DKIM, DMARC records (Zoho gives exact values)

### Create these email aliases:
- `hello@grassion.com` — main
- `contact@grassion.com` — contact form destination
- `support@grassion.com` — customer support
- `billing@grassion.com` — billing queries
- `no-reply@grassion.com` — not used (Resend handles outbound)

### Contact form auto-reply (code)

File: `apps/api/src/routes/contact.ts`

```typescript
import nodemailer from 'nodemailer'

const zohoTransporter = nodemailer.createTransport({
  host: process.env.ZOHO_SMTP_HOST,
  port: Number(process.env.ZOHO_SMTP_PORT),
  secure: false,
  auth: {
    user: process.env.ZOHO_SMTP_USER,
    pass: process.env.ZOHO_SMTP_PASS,
  },
})

app.post('/api/contact', async (req, res) => {
  const { name, email, message, topic } = req.body
  
  // Validate
  if (!name || !email || !message) return res.status(400).json({ error: 'Missing fields' })
  if (message.length > 5000) return res.status(400).json({ error: 'Message too long' })
  
  // 1. Forward to your inbox
  await zohoTransporter.sendMail({
    from: process.env.ZOHO_FROM_ADDRESS,
    to: 'contact@grassion.com',
    replyTo: email,
    subject: `[Grassion Contact] ${topic ?? 'General'} — ${name}`,
    text: `From: ${name} <${email}>\nTopic: ${topic}\n\n${message}`,
  })
  
  // 2. Auto-reply to sender
  await zohoTransporter.sendMail({
    from: process.env.ZOHO_FROM_ADDRESS,
    to: email,
    subject: `Thanks for reaching out to Grassion`,
    text: `Hi ${name},

Thanks for writing to Grassion. I got your message and I'll get back to you within 24 hours, usually sooner.

If it's urgent, reply to this email directly and it'll reach me faster.

— Mukti
Founder, Grassion
https://grassion.com`,
  })
  
  res.json({ ok: true })
})
```

---

## 6. Marketing Site — Full Content

**Tech:** Astro + Tailwind. Deploy to Vercel at `grassion.com`. Separate project from the app.

### Pages & copy (use this copy as-is, edit tone if you want)

#### Home page — `/`

**Hero (above the fold):**

> # Is your AI coding spend actually working?
> 
> Your team pays for Cursor, Copilot, Claude Code. Grassion tells you — in plain English — whether it's paying off. Install on GitHub in 2 minutes. No code leaves your servers.
>
> [Start free trial →]   [See how it works →]
>
> *14-day free trial · No credit card · Works with any GitHub repo*

**"The problem" section:**

> ### The question every CTO is being asked right now
>
> *"We're spending $X on AI coding tools. Is it working?"*
>
> Most teams can't answer. Merge speed went up — but so did rework. Cursor feels fast — but is it shipping bugs? No dashboard tells you the truth. You're flying blind with a growing invoice.

**"How it works" — 3 steps:**

> **1. Connect GitHub in 2 clicks**
> Install the Grassion GitHub App. Pick repos. Done. We read PR metadata only — never code content.
>
> **2. We detect AI-generated PRs automatically**
> Via commit trailers (Copilot, Claude Code), PR labels, and heuristics. No agent, no IDE plugin, no disruption.
>
> **3. You get the ROI verdict every Monday**
> One email. Four numbers. One verdict — *net positive, net negative, or unclear.* Plus the problem PRs worth reviewing.

**"What you get" — 4 things, clean grid:**

> - **Weekly ROI email** — plain English, under 200 words. You'll read it.
> - **One-page dashboard** — no charts, just the 4 numbers that matter.
> - **Problem PR list** — which AI-assisted PRs caused rework, with AI-written summaries.
> - **Honest detection** — we tell you what we catch and what we miss. No fake precision.

**"Who it's for":**

> Engineering teams with 5-50 developers who pay for AI coding tools and want to know if it's working. If your team spends $500+/month on Cursor, Copilot, or Claude Code, Grassion pays for itself on the first problem PR you catch.

**Pricing section:**

> ### Simple pricing. Charged per active developer.
>
> | Plan | Price | Best for |
> |---|---|---|
> | Starter | ₹2,400 / $29 per dev / month | 5-10 devs |
> | Team | ₹1,600 / $19 per dev / month (min 10 seats) | 10-30 devs |
> | Business | ₹41,000 / $499 flat / month | 30-50 devs |
> | Enterprise | Contact us | 50+ devs |
>
> 14-day free trial. No credit card to start. Cancel anytime.
>
> [Start free trial →]

**FAQ:**

> **Does my code leave my servers?**
> No. Grassion only reads PR metadata — titles, labels, commit messages, merge status, CI results. We never fetch or store code content.
>
> **How accurate is AI detection?**
> Near 100% for GitHub Copilot code review and Claude Code (they leave trailers). 30-50% for manual Cursor usage without trailers. Teams improve accuracy by using our PR labels (one click). We're transparent about what we miss.
>
> **Do I need to install anything in my IDE?**
> No. Grassion is a GitHub App. No IDE plugin, no agent, no developer friction.
>
> **What does "ROI" actually mean?**
> We estimate hours saved by AI (faster merges) vs hours lost to rework (reverts, hotfixes, follow-up fixes). Multiplied by your team's hourly rate. It's directional, not precise, and we tell you our confidence level.
>
> **Who built this?**
> Grassion is built by Mukti Prasad Behera, a Node.js developer who spent years wondering if his own AI tool spend was working. Now you'll know.

**Footer CTA:**

> ### Stop guessing. Start knowing.
> [Start your 14-day free trial →]

---

#### About page — `/about`

> # About Grassion
>
> Grassion was built because every engineering team in 2026 is spending real money on AI coding tools — and no one can answer whether it's working.
>
> ## Why this exists
>
> In late 2025, CodeRabbit raised $60M at a $550M valuation. Cursor crossed $500M ARR. GitHub Copilot hit 20 million developers. Every team is spending $20-60 per developer per month on AI tools. And every CFO is asking: *"Is this paying off?"*
>
> Traditional dev analytics tools measure velocity and cycle time. They don't measure whether AI-generated code is *actually* faster net of rework, reverts, and hotfixes. That's the gap Grassion fills.
>
> ## How we built it
>
> Grassion reads GitHub metadata only. We never touch your code. We detect AI-generated PRs through commit trailers (the ones Copilot, Claude Code, and Cursor leave), manual labels, and heuristics. Then we track what those PRs do after merge — reverts, downstream fixes, CI failures, hotfixes. We put it all in one number and tell you the truth.
>
> ## Who built it
>
> Mukti Prasad Behera is the founder of Grassion. He runs a small software agency (Cluenuts Technology) and has been building products since 2019. Grassion is his focused bet on a problem he's lived through: *knowing where his AI tool money actually goes.*
>
> ## What we believe
>
> - **Honest measurement beats fake precision.** We tell you what we can and can't measure.
> - **One number beats fifty charts.** A CTO shouldn't need 30 minutes to answer "is AI paying off."
> - **Your code is yours.** We don't read it. We don't store it. We don't need it.
> - **Small teams deserve real tools.** Not every measurement tool should require a $50k contract.
>
> ## Get in touch
>
> Questions, feedback, bugs: [contact@grassion.com](mailto:contact@grassion.com)

---

#### Contact page — `/contact`

> # Contact Grassion
>
> Email me directly — the fastest way to reach a human (me) is the form below. I reply within 24 hours, usually same-day.
>
> [FORM: Name, Email, Topic dropdown (Sales / Support / Bug / Other), Message]
>
> Prefer email? [hello@grassion.com](mailto:hello@grassion.com)

Form submits to `/api/contact` (code in section 5).

---

#### Privacy page — `/privacy`

> # Privacy Policy
>
> **Last updated:** [DATE]
>
> Grassion is a GitHub App that reads pull request metadata to help teams measure AI coding tool ROI. This policy explains what we collect and how we use it.
>
> ## What we collect
>
> - **GitHub metadata only:** PR titles, descriptions, labels, commit messages, author, merge status, CI check results. We do NOT fetch or store code content.
> - **Account data:** your GitHub login, email (from GitHub OAuth), and team membership.
> - **Usage data:** pages visited, errors, performance (via Sentry/Plausible).
>
> ## What we don't collect
>
> - Source code
> - File contents
> - Private messages or issue contents beyond what's in PR metadata
> - Any data from repositories you haven't explicitly connected
>
> ## How we use it
>
> - Detect AI-generated PRs and compute ROI metrics for your team
> - Send weekly digest emails (you can opt out in settings)
> - Provide dashboard features
>
> ## Who we share it with
>
> - **OpenAI** receives anonymized PR titles and outcome signals to generate human-readable summaries. We do not send commit messages, code, or author information.
> - **Resend** delivers transactional emails on our behalf.
> - **Razorpay** processes payments.
> - We do not sell data to anyone, ever.
>
> ## Your rights
>
> - Export your data: email [contact@grassion.com](mailto:contact@grassion.com)
> - Delete your data: uninstall the GitHub App or email us for full account deletion
> - Access logs, DPA, security: available on request
>
> ## Contact
>
> Questions about privacy: [contact@grassion.com](mailto:contact@grassion.com)
>
> Grassion is operated by Cluenuts Technology Private Limited, Bhubaneswar, Odisha, India.

---

#### Terms page — `/terms`

> # Terms of Service
>
> **Last updated:** [DATE]
>
> By using Grassion, you agree to these terms.
>
> ## The service
>
> Grassion measures AI coding tool ROI from GitHub metadata. We make no guarantee that measurements are precise — they are estimates, and we disclose our confidence levels.
>
> ## Your account
>
> - You must be authorized to install GitHub Apps on any account you connect to Grassion.
> - You're responsible for keeping your login secure.
> - One account per organization recommended; multi-team accounts require explicit admin role.
>
> ## Payments
>
> - Plans billed monthly via Razorpay (primary) or Stripe (when available).
> - Free trial: 14 days, no card required.
> - Cancel anytime; access continues until end of billing cycle.
> - Refunds: pro-rated for annual plans only, case-by-case for monthly.
>
> ## Limitations
>
> - Grassion is provided "as is" without warranties.
> - Our liability is limited to the amount you paid us in the prior 12 months.
> - Don't use Grassion for illegal activity.
>
> ## Termination
>
> We may suspend accounts for abuse, non-payment, or policy violation with reasonable notice.
>
> ## Contact
>
> [contact@grassion.com](mailto:contact@grassion.com)
>
> Governing law: Odisha, India.

---

## 7. Updated 6-Week Build Calendar

### Week 1 — Foundation
- [ ] Create pnpm monorepo, TypeScript, Drizzle schema (with llm_usage_log, ai_summary columns)
- [ ] GitHub App creation + webhook endpoint
- [ ] Razorpay account signup (**start KYC TODAY — takes 1-2 days**)
- [ ] Zoho Mail domain setup (MX + SPF + DKIM)
- [ ] Deploy API skeleton to Fly.io + empty web + empty marketing to Vercel
- [ ] **Public posts 1 + 2 (see social docs)**

### Week 2 — PR Ingestion + AI Detection
- [ ] `detectAI()` function + unit tests
- [ ] Webhook handlers for all PR events
- [ ] 60-day backfill per repo on install
- [ ] Marketing site: home page shipped
- [ ] **Public posts 3 + 4**

### Week 3 — Outcome Tracking + Dashboard v1
- [ ] Worker cron — outcome tracker (every 6h)
- [ ] Weekly metrics computation
- [ ] OpenAI PR summary function + budget guard
- [ ] GitHub OAuth login
- [ ] Dashboard page with 4 stat cards
- [ ] Marketing site: about, pricing pages shipped
- [ ] **Public posts 5 + 6**

### Week 4 — Email + Billing + Contact Form
- [ ] Resend weekly digest template (with AI summaries from OpenAI)
- [ ] Razorpay subscription flow + webhook handler
- [ ] Contact form + Zoho auto-reply
- [ ] Settings page (AI spend, hourly rate, timezone, digest prefs)
- [ ] Onboarding flow (install → pick repos → set AI spend → done)
- [ ] **Public posts 7 + 8**

### Week 5 — Polish + Full Marketing Site
- [ ] Contact page, privacy, terms pages
- [ ] Empty states, loading, error handling
- [ ] Plausible Analytics on marketing + app
- [ ] Favicon, OG images, meta tags for SEO
- [ ] Sentry error tracking
- [ ] Internal docs / runbook
- [ ] **Public posts 9 + 10**

### Week 6 — Launch
- [ ] Show HN post
- [ ] Product Hunt schedule
- [ ] Indie Hackers milestone
- [ ] DM 20 warm contacts (only now, not before)
- [ ] Submit to YC application (Winter/Summer batch, whichever is open)
- [ ] Submit to Google for Startups / Sequoia Surge / other accelerators
- [ ] **Public posts 11 + 12 + launch day**

---

## 8. Accelerator / Competition Application Checklist

Apply to all these in week 6 (2-4 hours each, batch on one Saturday):

- [ ] **YC** (apps.ycombinator.com) — rolling, try next batch
- [ ] **Google for Startups Accelerator (India)** — cohort-based, accept rolling
- [ ] **Sequoia Surge** — India-focused, seed stage
- [ ] **AngelList Rolling Fund** — for solo founders
- [ ] **Accel Atoms** (India) — early stage accelerator
- [ ] **Microsoft for Startups** — free Azure + GitHub Enterprise credits (useful for you)
- [ ] **Antler** — rolling intake, takes pre-revenue
- [ ] **NASSCOM DeepTech Club** — free for Indian startups
- [ ] **Startup India** (startupindia.gov.in) — DPIIT recognition for tax benefits
- [ ] **Product Hunt Maker Festival** — when it runs
- [ ] **#BuildInPublic** Twitter/X community — not a competition, but visibility

**Honest expectation:** YC rejects 98.5% of applicants. Most India accelerators accept 1-5%. But applications force clarity. Budget 1 hour per day max, only after the real work is done.

---

## 9. What To Tell Claude Code Right Now

If Claude Code is already building from the v1 spec, paste this:

> Before continuing, apply these v2 changes to the project:
>
> 1. Swap Stripe integration for Razorpay in `apps/api/src/billing/` and `apps/web/src/pages/Billing.tsx`. Use Razorpay subscription API. Add frontend Razorpay checkout SDK via script tag in index.html.
>
> 2. Add a new app `apps/marketing/` using Astro + Tailwind. Build these pages with the copy from Section 6 of GRASSION_BUILD_SPEC_V2.md: /, /about, /pricing, /contact, /privacy, /terms. Deploy target: grassion.com on Vercel.
>
> 3. Add OpenAI integration in `apps/worker/src/llm/pr-summary.ts` per section 4. Add budget guard at $10/month via OPENAI_MONTHLY_BUDGET_USD env var. Add `llm_usage_log` table and `ai_summary` columns to schema.
>
> 4. Add contact form route at `apps/api/src/routes/contact.ts` using nodemailer + Zoho SMTP for auto-reply. Keep Resend for transactional email.
>
> 5. Update env.example with new variables listed in section 2.
>
> Do not add any product features not in the v1 spec. This update only adds: landing/marketing, Razorpay, OpenAI for PR summaries, contact form. Confirm before starting.

---

**End of v2 spec.**
