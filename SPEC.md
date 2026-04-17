# Grassion — Complete MVP Build Spec

**Version:** 1.0
**Target:** 6-week solo-founder build using Claude Code
**Stack:** Node.js + Express (API) · React + Vite (Web) · Postgres (Neon) · Fly.io (hosting) · Vercel (frontend) · Resend (email) · Stripe (billing)

---

## 0. What Grassion Is (One Paragraph)

Grassion is a GitHub App that measures whether small engineering teams' AI coding tool spend (Copilot, Cursor, Claude Code) is actually paying off. It detects AI-generated PRs automatically (via commit trailers and PR labels), tracks what happens to them after merge (reverts, rework, hotfixes, CI failures), and produces a weekly email + dashboard showing the ROI verdict in plain English. Target buyer: founding engineers and CTOs at 5–25 dev startups. Price: $29/dev/month.

---

## 1. Repository Structure

```
grassion/
├── apps/
│   ├── api/              # Express backend — webhooks, REST API, auth
│   ├── web/              # React + Vite frontend — dashboard, settings
│   └── worker/           # Node cron — outcome tracker, weekly email
├── packages/
│   ├── db/               # Drizzle schema + migrations (shared)
│   └── shared/           # TypeScript types shared between api/web/worker
├── .github/workflows/    # CI deploy to Fly.io + Vercel
├── fly.api.toml          # Fly config for API
├── fly.worker.toml       # Fly config for worker
├── package.json          # root pnpm workspace
├── pnpm-workspace.yaml
├── .env.example
└── README.md
```

Use **pnpm workspaces**. Don't use npm or yarn — pnpm handles monorepos cleanly.

---

## 2. Dependencies

### Root `package.json`
```json
{
  "name": "grassion",
  "private": true,
  "scripts": {
    "dev": "pnpm -r --parallel dev",
    "build": "pnpm -r build",
    "db:generate": "pnpm --filter @grassion/db generate",
    "db:migrate": "pnpm --filter @grassion/db migrate"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "prettier": "^3.3.0"
  }
}
```

### `apps/api/package.json`
Key dependencies:
- `express` — HTTP server
- `@octokit/app` + `@octokit/webhooks` — GitHub App logic
- `drizzle-orm` + `postgres` — DB
- `zod` — validation
- `stripe` — billing
- `jsonwebtoken` — session tokens
- `cors`, `helmet`, `express-rate-limit`
- `pino` — logging

### `apps/worker/package.json`
- `drizzle-orm` + `postgres`
- `@octokit/rest` — fetching PR data
- `node-cron` — scheduling
- `resend` — sending emails
- `pino`

### `apps/web/package.json`
- `react`, `react-dom`, `react-router-dom`
- `vite`, `@vitejs/plugin-react`
- `tailwindcss`, `@tailwindcss/forms`
- `@radix-ui/react-*` (via shadcn/ui components)
- `lucide-react` — icons
- `@tanstack/react-query` — data fetching
- `date-fns` — dates

### `packages/db/package.json`
- `drizzle-orm`, `drizzle-kit`
- `postgres`

---

## 3. Environment Variables

Create `.env.example` at root:

```bash
# Database
DATABASE_URL=postgres://user:pass@host:5432/grassion

# GitHub App (create at https://github.com/settings/apps/new)
GITHUB_APP_ID=
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
GITHUB_APP_CLIENT_ID=
GITHUB_APP_CLIENT_SECRET=
GITHUB_APP_WEBHOOK_SECRET=
GITHUB_APP_SLUG=grassion

# Auth
JWT_SECRET=replace_with_random_64_char_string
SESSION_COOKIE_DOMAIN=.grassion.com

# Stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ID_STARTER=price_...

# Email
RESEND_API_KEY=re_...
EMAIL_FROM="Grassion <hello@grassion.com>"

# URLs
APP_URL=https://app.grassion.com
API_URL=https://api.grassion.com
MARKETING_URL=https://grassion.com

# Node
NODE_ENV=development
PORT=3001
LOG_LEVEL=info
```

---

## 4. Database Schema (Drizzle + Postgres)

File: `packages/db/src/schema.ts`

```typescript
import { pgTable, text, integer, timestamp, boolean, real, jsonb, uuid, uniqueIndex, index } from 'drizzle-orm/pg-core'

// ============ TEAMS ============
export const teams = pgTable('teams', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  githubInstallationId: integer('github_installation_id').unique(),
  githubAccountLogin: text('github_account_login'), // org or user
  githubAccountType: text('github_account_type'), // 'Organization' | 'User'
  
  // Billing
  stripeCustomerId: text('stripe_customer_id').unique(),
  stripeSubscriptionId: text('stripe_subscription_id'),
  plan: text('plan').notNull().default('trial'), // trial | starter | team | business
  trialEndsAt: timestamp('trial_ends_at'),
  
  // AI spend tracking (user input)
  monthlyAiSpendUsd: real('monthly_ai_spend_usd').default(0),
  avgDevHourlyRateUsd: real('avg_dev_hourly_rate_usd').default(75), // for ROI calc
  
  // Settings
  timezone: text('timezone').default('UTC'),
  emailDigestEnabled: boolean('email_digest_enabled').default(true),
  emailDigestDay: integer('email_digest_day').default(1), // 1=Monday
  emailDigestHour: integer('email_digest_hour').default(9),
  
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ============ USERS ============
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  teamId: uuid('team_id').references(() => teams.id, { onDelete: 'cascade' }).notNull(),
  githubUserId: integer('github_user_id').notNull(),
  githubLogin: text('github_login').notNull(),
  email: text('email'),
  avatarUrl: text('avatar_url'),
  role: text('role').notNull().default('member'), // owner | admin | member
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  teamGhIdx: uniqueIndex('users_team_gh_idx').on(t.teamId, t.githubUserId),
}))

// ============ REPOS ============
export const repos = pgTable('repos', {
  id: uuid('id').defaultRandom().primaryKey(),
  teamId: uuid('team_id').references(() => teams.id, { onDelete: 'cascade' }).notNull(),
  githubRepoId: integer('github_repo_id').notNull().unique(),
  owner: text('owner').notNull(),
  name: text('name').notNull(),
  defaultBranch: text('default_branch').default('main'),
  isActive: boolean('is_active').default(true),
  connectedAt: timestamp('connected_at').defaultNow().notNull(),
  lastSyncedAt: timestamp('last_synced_at'),
})

// ============ PULL REQUESTS ============
export const pullRequests = pgTable('pull_requests', {
  id: uuid('id').defaultRandom().primaryKey(),
  teamId: uuid('team_id').references(() => teams.id, { onDelete: 'cascade' }).notNull(),
  repoId: uuid('repo_id').references(() => repos.id, { onDelete: 'cascade' }).notNull(),
  
  githubPrId: integer('github_pr_id').notNull().unique(),
  githubPrNumber: integer('github_pr_number').notNull(),
  
  title: text('title').notNull(),
  state: text('state').notNull(), // open | merged | closed
  authorGithubId: integer('author_github_id'),
  authorLogin: text('author_login'),
  
  openedAt: timestamp('opened_at').notNull(),
  mergedAt: timestamp('merged_at'),
  closedAt: timestamp('closed_at'),
  mergeCommitSha: text('merge_commit_sha'),
  
  additions: integer('additions').default(0),
  deletions: integer('deletions').default(0),
  changedFiles: integer('changed_files').default(0),
  commitCount: integer('commit_count').default(0),
  
  // AI detection
  aiSource: text('ai_source'), // 'copilot' | 'cursor' | 'claude' | 'windsurf' | 'unknown_ai' | null
  aiDetectionMethod: text('ai_detection_method'), // 'trailer' | 'body_regex' | 'label' | 'manual'
  aiConfidence: real('ai_confidence').default(0),
  
  rawMetadata: jsonb('raw_metadata'), // store commits, labels for reprocessing
  
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  teamMergedIdx: index('pr_team_merged_idx').on(t.teamId, t.mergedAt),
  teamAiIdx: index('pr_team_ai_idx').on(t.teamId, t.aiSource),
}))

// ============ PR OUTCOMES ============
export const prOutcomes = pgTable('pr_outcomes', {
  prId: uuid('pr_id').references(() => pullRequests.id, { onDelete: 'cascade' }).primaryKey(),
  teamId: uuid('team_id').references(() => teams.id, { onDelete: 'cascade' }).notNull(),
  
  wasReverted: boolean('was_reverted').default(false),
  revertedAt: timestamp('reverted_at'),
  revertPrNumber: integer('revert_pr_number'),
  
  ciFailureCount: integer('ci_failure_count').default(0),
  downstreamFixCount: integer('downstream_fix_count').default(0), // PRs referencing "fixes #N"
  downstreamFixPrNumbers: jsonb('downstream_fix_pr_numbers'), // array of ints
  hadHotfixWithin7d: boolean('had_hotfix_within_7d').default(false),
  
  reworkScore: real('rework_score').default(0), // 0-100 composite
  
  computedAt: timestamp('computed_at').defaultNow().notNull(),
}, (t) => ({
  teamIdx: index('outcomes_team_idx').on(t.teamId),
}))

// ============ WEEKLY METRICS CACHE ============
export const teamWeeklyMetrics = pgTable('team_weekly_metrics', {
  id: uuid('id').defaultRandom().primaryKey(),
  teamId: uuid('team_id').references(() => teams.id, { onDelete: 'cascade' }).notNull(),
  weekStart: timestamp('week_start').notNull(), // Monday 00:00 UTC
  
  totalPrs: integer('total_prs').default(0),
  aiPrs: integer('ai_prs').default(0),
  humanPrs: integer('human_prs').default(0),
  
  aiAvgMergeHours: real('ai_avg_merge_hours'),
  humanAvgMergeHours: real('human_avg_merge_hours'),
  aiReworkRate: real('ai_rework_rate'), // 0-1
  humanReworkRate: real('human_rework_rate'),
  
  estimatedHoursSaved: real('estimated_hours_saved').default(0),
  estimatedHoursLost: real('estimated_hours_lost').default(0),
  estimatedDollarSaved: real('estimated_dollar_saved').default(0),
  estimatedDollarLost: real('estimated_dollar_lost').default(0),
  
  verdict: text('verdict'), // 'net_positive' | 'net_negative' | 'unclear' | 'insufficient_data'
  
  computedAt: timestamp('computed_at').defaultNow().notNull(),
}, (t) => ({
  teamWeekIdx: uniqueIndex('metrics_team_week_idx').on(t.teamId, t.weekStart),
}))

// ============ AUTH SESSIONS ============
export const sessions = pgTable('sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// ============ EMAIL DIGEST LOG ============
export const emailDigests = pgTable('email_digests', {
  id: uuid('id').defaultRandom().primaryKey(),
  teamId: uuid('team_id').references(() => teams.id, { onDelete: 'cascade' }).notNull(),
  sentAt: timestamp('sent_at').defaultNow().notNull(),
  weekStart: timestamp('week_start').notNull(),
  recipientCount: integer('recipient_count'),
  status: text('status'), // 'sent' | 'failed'
  errorMessage: text('error_message'),
})
```

Drizzle config: `packages/db/drizzle.config.ts`
```typescript
import type { Config } from 'drizzle-kit'
export default {
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
} satisfies Config
```

---

## 5. GitHub App Setup

**You create this manually before coding:**

1. Go to https://github.com/settings/apps/new
2. Name: `Grassion`
3. Homepage URL: `https://grassion.com`
4. Webhook URL: `https://api.grassion.com/webhooks/github` (update after Fly deploy)
5. Webhook secret: generate random 32-char string → save as `GITHUB_APP_WEBHOOK_SECRET`
6. **Permissions (Repository):**
   - Contents: Read-only (for commit data)
   - Issues: Read-only (for "fixes #N" detection)
   - Metadata: Read-only (required)
   - Pull requests: Read-only
   - Checks: Read-only (for CI status)
7. **Permissions (Account):** Email address: Read-only (for onboarding emails)
8. **Subscribe to events:**
   - Pull request
   - Pull request review
   - Push
   - Check run
   - Installation
   - Installation repositories
9. **Where can this GitHub App be installed?** → Any account
10. Download the private key (`.pem` file) → convert to single-line for env var
11. Copy App ID, Client ID, Client Secret → save to env

---

## 6. AI Detection Logic (Complete)

File: `apps/worker/src/ai-detection.ts`

```typescript
interface DetectionResult {
  source: 'copilot' | 'cursor' | 'claude' | 'windsurf' | 'unknown_ai' | null
  method: 'trailer' | 'body_regex' | 'label' | 'manual' | null
  confidence: number
}

interface PRForDetection {
  body: string | null
  labels: string[]
  commits: Array<{ message: string; author: { name?: string; email?: string } }>
}

const TOOL_PATTERNS = {
  copilot: /copilot/i,
  cursor: /cursor/i,
  claude: /claude|anthropic/i,
  windsurf: /windsurf|codeium/i,
}

function identifyTool(text: string): DetectionResult['source'] {
  if (TOOL_PATTERNS.copilot.test(text)) return 'copilot'
  if (TOOL_PATTERNS.cursor.test(text)) return 'cursor'
  if (TOOL_PATTERNS.claude.test(text)) return 'claude'
  if (TOOL_PATTERNS.windsurf.test(text)) return 'windsurf'
  return 'unknown_ai'
}

export function detectAI(pr: PRForDetection): DetectionResult {
  // Priority 1: manual labels (100% confidence)
  for (const label of pr.labels) {
    const m = label.match(/^grassion:ai-(copilot|cursor|claude|windsurf)$/)
    if (m) return { source: m[1] as any, method: 'label', confidence: 1.0 }
    if (label === 'grassion:ai') return { source: 'unknown_ai', method: 'label', confidence: 1.0 }
    if (label === 'grassion:human') return { source: null, method: 'label', confidence: 1.0 }
  }

  // Priority 2: commit trailers (0.95 confidence)
  for (const commit of pr.commits) {
    const lines = commit.message.split('\n')
    for (const line of lines) {
      const trailerMatch = line.match(/^Co-authored-by:\s*(.+?)\s*<(.+?)>$/i)
      if (trailerMatch) {
        const [, name, email] = trailerMatch
        const combined = `${name} ${email}`
        
        // Copilot uses noreply emails
        if (/copilot/i.test(combined) || email.includes('Copilot@users.noreply.github.com')) {
          return { source: 'copilot', method: 'trailer', confidence: 0.95 }
        }
        if (/claude|anthropic/i.test(combined)) {
          return { source: 'claude', method: 'trailer', confidence: 0.95 }
        }
        if (/cursor/i.test(combined)) {
          return { source: 'cursor', method: 'trailer', confidence: 0.95 }
        }
      }
    }
  }

  // Priority 3: PR body regex (0.70 confidence)
  if (pr.body) {
    const patterns = [
      /generated (?:by|with|using) (copilot|cursor|claude|windsurf)/i,
      /(copilot|cursor|claude|windsurf) (?:wrote|authored|generated|assisted)/i,
      /🤖.*?(copilot|cursor|claude|windsurf)/i,
      /\b(?:ai[- ]?(?:generated|assisted|written))\b/i,
    ]
    for (const pattern of patterns) {
      const match = pr.body.match(pattern)
      if (match) {
        const source = match[1] ? identifyTool(match[1]) : 'unknown_ai'
        return { source, method: 'body_regex', confidence: 0.70 }
      }
    }
  }

  return { source: null, method: null, confidence: 0 }
}
```

---

## 7. Outcome Tracking Logic

File: `apps/worker/src/outcome-tracker.ts`

```typescript
/**
 * Runs every 6 hours. For each merged PR aged 7-30 days, compute outcomes.
 * Why 7-30 days: <7 is too early for rework signals; >30 is historical, not worth re-checking.
 */

export async function trackOutcomesForTeam(teamId: string) {
  const merged = await db.query.pullRequests.findMany({
    where: and(
      eq(pullRequests.teamId, teamId),
      eq(pullRequests.state, 'merged'),
      gte(pullRequests.mergedAt, daysAgo(30)),
      lte(pullRequests.mergedAt, daysAgo(7)),
    ),
    with: { repo: true },
  })

  for (const pr of merged) {
    const outcome = await computeOutcome(pr)
    await db.insert(prOutcomes).values(outcome).onConflictDoUpdate({
      target: prOutcomes.prId,
      set: outcome,
    })
  }
}

async function computeOutcome(pr: PR & { repo: Repo }) {
  // 1. Was this PR reverted?
  const revertPr = await findRevertPR(pr)
  
  // 2. Count downstream "fixes #N" PRs
  const downstreamFixes = await findDownstreamFixPRs(pr)
  
  // 3. CI failures on the merge commit or before
  const ciFailures = await countCIFailures(pr)
  
  // 4. Hotfix within 7 days (PR with label 'hotfix' or 'urgent' touching same files)
  const hadHotfix = await checkHotfixWithin7d(pr)
  
  // 5. Composite rework score
  const reworkScore = computeReworkScore({
    wasReverted: !!revertPr,
    downstreamFixCount: downstreamFixes.length,
    ciFailureCount: ciFailures,
    hadHotfix,
  })
  
  return {
    prId: pr.id,
    teamId: pr.teamId,
    wasReverted: !!revertPr,
    revertedAt: revertPr?.mergedAt,
    revertPrNumber: revertPr?.githubPrNumber,
    ciFailureCount: ciFailures,
    downstreamFixCount: downstreamFixes.length,
    downstreamFixPrNumbers: downstreamFixes.map(p => p.githubPrNumber),
    hadHotfixWithin7d: hadHotfix,
    reworkScore,
    computedAt: new Date(),
  }
}

function computeReworkScore(signals: {
  wasReverted: boolean
  downstreamFixCount: number
  ciFailureCount: number
  hadHotfix: boolean
}): number {
  let score = 0
  if (signals.wasReverted) score += 60
  score += Math.min(signals.downstreamFixCount * 15, 30)
  score += Math.min(signals.ciFailureCount * 5, 20)
  if (signals.hadHotfix) score += 25
  return Math.min(score, 100)
}

async function findRevertPR(pr: PR & { repo: Repo }) {
  // GitHub convention: revert PR title is "Revert \"<original title>\""
  // Search PRs merged after `pr` in same repo with matching title pattern
  const candidates = await db.query.pullRequests.findMany({
    where: and(
      eq(pullRequests.repoId, pr.repoId),
      gt(pullRequests.mergedAt, pr.mergedAt!),
    ),
  })
  const revertTitle = `Revert "${pr.title}"`
  return candidates.find(c => c.title === revertTitle || c.title.startsWith(`Revert "${pr.title.slice(0, 30)}`))
}

async function findDownstreamFixPRs(pr: PR & { repo: Repo }) {
  // Search merged PRs in same repo where body/title references "fixes #<pr.number>" or "closes #<pr.number>"
  const refPattern = new RegExp(`(fix(?:es)?|close[sd]?|resolve[sd]?)\\s+#${pr.githubPrNumber}\\b`, 'i')
  const recent = await db.query.pullRequests.findMany({
    where: and(
      eq(pullRequests.repoId, pr.repoId),
      eq(pullRequests.state, 'merged'),
      gt(pullRequests.mergedAt, pr.mergedAt!),
    ),
  })
  return recent.filter(p => refPattern.test(p.title) || (p.rawMetadata as any)?.body && refPattern.test((p.rawMetadata as any).body))
}

async function countCIFailures(pr: PR & { repo: Repo }) {
  // Use stored check runs from webhook events (we store these in rawMetadata)
  const checks = (pr.rawMetadata as any)?.check_runs ?? []
  return checks.filter((c: any) => c.conclusion === 'failure').length
}

async function checkHotfixWithin7d(pr: PR & { repo: Repo }) {
  const hotfixes = await db.query.pullRequests.findMany({
    where: and(
      eq(pullRequests.repoId, pr.repoId),
      eq(pullRequests.state, 'merged'),
      gt(pullRequests.mergedAt, pr.mergedAt!),
      lt(pullRequests.mergedAt, addDays(pr.mergedAt!, 7)),
    ),
  })
  return hotfixes.some(h => {
    const labels = (h.rawMetadata as any)?.labels ?? []
    return labels.some((l: any) => /hotfix|urgent|critical/i.test(l.name))
  })
}
```

---

## 8. Weekly Metrics Computation

File: `apps/worker/src/metrics.ts`

```typescript
/**
 * Runs weekly (Sunday 11pm team timezone). Computes the dashboard numbers.
 */

export async function computeWeeklyMetrics(teamId: string, weekStart: Date) {
  const weekEnd = addDays(weekStart, 7)
  
  const prs = await db.query.pullRequests.findMany({
    where: and(
      eq(pullRequests.teamId, teamId),
      eq(pullRequests.state, 'merged'),
      gte(pullRequests.mergedAt, weekStart),
      lt(pullRequests.mergedAt, weekEnd),
    ),
    with: { outcome: true },
  })

  const aiPrs = prs.filter(p => p.aiSource)
  const humanPrs = prs.filter(p => !p.aiSource)

  const aiAvgMergeHours = avg(aiPrs.map(p => hoursBetween(p.openedAt, p.mergedAt!)))
  const humanAvgMergeHours = avg(humanPrs.map(p => hoursBetween(p.openedAt, p.mergedAt!)))

  const aiReworkRate = rateOfRework(aiPrs)
  const humanReworkRate = rateOfRework(humanPrs)

  // ROI estimation (honest, rough, disclosed to user)
  const team = await db.query.teams.findFirst({ where: eq(teams.id, teamId) })
  const rate = team?.avgDevHourlyRateUsd ?? 75
  const spend = team?.monthlyAiSpendUsd ?? 0

  // Hours saved: if AI merges faster, the time delta × count = saved
  const speedDeltaHours = Math.max(0, humanAvgMergeHours - aiAvgMergeHours)
  const estimatedHoursSaved = speedDeltaHours * aiPrs.length * 0.3 // 30% dampener — merge speed ≠ dev time saved 1:1

  // Hours lost: rework PRs take rework time
  const reworkPrs = aiPrs.filter(p => (p.outcome?.reworkScore ?? 0) > 30)
  const estimatedHoursLost = reworkPrs.length * 3 // assume 3 hours per rework incident

  const estimatedDollarSaved = estimatedHoursSaved * rate
  const estimatedDollarLost = estimatedHoursLost * rate + (spend / 4) // weekly share of monthly AI spend

  const netDollar = estimatedDollarSaved - estimatedDollarLost

  const verdict = prs.length < 5 
    ? 'insufficient_data'
    : netDollar > 100 ? 'net_positive' 
    : netDollar < -100 ? 'net_negative' 
    : 'unclear'

  return {
    teamId,
    weekStart,
    totalPrs: prs.length,
    aiPrs: aiPrs.length,
    humanPrs: humanPrs.length,
    aiAvgMergeHours,
    humanAvgMergeHours,
    aiReworkRate,
    humanReworkRate,
    estimatedHoursSaved,
    estimatedHoursLost,
    estimatedDollarSaved,
    estimatedDollarLost,
    verdict,
    computedAt: new Date(),
  }
}

function rateOfRework(prs: any[]): number {
  if (prs.length === 0) return 0
  const reworked = prs.filter(p => (p.outcome?.reworkScore ?? 0) > 30)
  return reworked.length / prs.length
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0
  return nums.reduce((a, b) => a + b, 0) / nums.length
}

function hoursBetween(a: Date, b: Date) {
  return (b.getTime() - a.getTime()) / 36e5
}
```

---

## 9. Backend API Routes

File: `apps/api/src/routes/index.ts`

```typescript
// Public
GET  /health                          → 200 ok
POST /webhooks/github                 → handle GitHub App webhooks
POST /webhooks/stripe                 → handle Stripe webhooks

// Auth
GET  /auth/github                     → start GitHub OAuth
GET  /auth/github/callback            → complete OAuth, create session, redirect to app
POST /auth/logout                     → clear session
GET  /auth/me                         → current user + team

// Team
GET  /api/team                        → current team info
PATCH /api/team                       → update settings (timezone, AI spend, hourly rate)
GET  /api/team/members                → list members
DELETE /api/team/members/:id          → remove member (owner/admin only)

// Repos
GET  /api/repos                       → list connected repos
POST /api/repos/:id/toggle            → enable/disable tracking

// PRs + Metrics (the actual product)
GET  /api/metrics/summary             → dashboard summary (4 numbers + verdict)
GET  /api/metrics/weekly              → last 12 weeks of metrics
GET  /api/prs/problem                 → list of problem PRs (high rework score)
GET  /api/prs/:id                     → PR detail

// Billing
POST /api/billing/checkout            → create Stripe Checkout session
POST /api/billing/portal              → create Stripe Customer Portal session
GET  /api/billing/subscription        → current plan + status
```

### Webhook handler (critical code)

File: `apps/api/src/webhooks/github.ts`

```typescript
import { App } from '@octokit/app'
import { Webhooks } from '@octokit/webhooks'

const webhooks = new Webhooks({ secret: process.env.GITHUB_APP_WEBHOOK_SECRET! })

webhooks.on('installation.created', async ({ payload }) => {
  // Create team, store installation_id, sync repos
  await createTeamFromInstallation(payload.installation)
  for (const repo of payload.repositories ?? []) {
    await connectRepo(payload.installation.id, repo)
  }
})

webhooks.on('installation.deleted', async ({ payload }) => {
  await deactivateTeam(payload.installation.id)
})

webhooks.on(['pull_request.opened', 'pull_request.edited', 'pull_request.closed', 'pull_request.reopened'], async ({ payload }) => {
  await upsertPR(payload)
  if (payload.action === 'closed' && payload.pull_request.merged) {
    // Schedule outcome tracking in 7 days
    await scheduleOutcomeCheck(payload.pull_request.id, addDays(new Date(), 7))
  }
})

webhooks.on('pull_request.labeled', async ({ payload }) => {
  // Re-run AI detection if a grassion:* label was added
  if (payload.label?.name.startsWith('grassion:')) {
    await recomputeAI(payload.pull_request.id)
  }
})

webhooks.on('check_run.completed', async ({ payload }) => {
  // Store check run status for CI failure counting
  await storeCheckRun(payload.repository.id, payload.check_run)
})

export default webhooks
```

---

## 10. Frontend (React + Vite)

### Pages

```
/                        → marketing landing (on grassion.com, separate Vercel project)
/app/login               → "Sign in with GitHub" button
/app/install             → "Install Grassion on GitHub" → GitHub App install flow
/app/dashboard           → THE MAIN PAGE (4 numbers + problem PRs)
/app/settings            → team settings, AI spend input, repos, members
/app/billing             → current plan + upgrade
/app/onboarding          → 3-step onboarding after first install
```

### The Dashboard Component (the whole product in one page)

File: `apps/web/src/pages/Dashboard.tsx` — psuedocode sketch:

```tsx
export function Dashboard() {
  const { data: summary } = useQuery(['metrics', 'summary'], fetchSummary)
  const { data: problemPRs } = useQuery(['prs', 'problem'], fetchProblemPRs)

  if (!summary) return <LoadingState />
  if (summary.verdict === 'insufficient_data') return <InsufficientDataState />

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      {/* Hero verdict */}
      <VerdictBadge verdict={summary.verdict} netDollar={summary.netDollar} />

      {/* 4 numbers */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="AI Merge Speed" value={`${summary.speedDeltaPercent}%`} sub="faster than human PRs" good={summary.speedDeltaPercent > 0} />
        <StatCard label="AI Rework Rate" value={`${summary.reworkMultiplier}×`} sub="vs human PRs" good={summary.reworkMultiplier < 1.2} />
        <StatCard label="AI Spend" value={`$${summary.monthlySpend}`} sub="this month" />
        <StatCard label="AI PRs Shipped" value={`${summary.aiPrs}/${summary.totalPrs}`} sub={`${Math.round(summary.aiPrs/summary.totalPrs*100)}% of total`} />
      </div>

      {/* Problem PRs list */}
      <ProblemPRsList prs={problemPRs ?? []} />
    </div>
  )
}
```

Use **shadcn/ui** components for Card, Badge, Button. Install via:
```bash
npx shadcn@latest init
npx shadcn@latest add card button badge table alert
```

---

## 11. Weekly Email Template

File: `apps/worker/src/emails/weekly-digest.ts`

```typescript
export function weeklyDigestText(data: {
  teamName: string
  weekStart: Date
  totalPrs: number
  aiPrs: number
  speedDeltaPercent: number
  reworkMultiplier: number
  netDollar: number
  verdict: 'net_positive' | 'net_negative' | 'unclear'
  problemPrs: Array<{ number: number; title: string; reason: string; url: string }>
  dashboardUrl: string
}) {
  const verdictLine = {
    net_positive: `✅ Net positive this week: +$${data.netDollar.toFixed(0)} estimated.`,
    net_negative: `⚠️ Net negative this week: -$${Math.abs(data.netDollar).toFixed(0)} estimated.`,
    unclear: `➖ Unclear this week. Not enough signal to call it.`,
  }[data.verdict]

  return `Hey ${data.teamName},

Last week your team merged ${data.totalPrs} PRs. ${data.aiPrs} were AI-assisted.

AI PRs merged ${data.speedDeltaPercent}% faster than human PRs, but had a ${data.reworkMultiplier}× rework rate.

${verdictLine}

${data.problemPrs.length > 0 ? `
Problem PRs worth reviewing:
${data.problemPrs.map(p => `  • #${p.number} ${p.title} — ${p.reason}\n    ${p.url}`).join('\n')}
` : ''}

See full dashboard: ${data.dashboardUrl}

— Grassion

---
Reply STOP to pause these digests. Change your AI spend estimate in settings to improve accuracy.`
}
```

Send via Resend:
```typescript
import { Resend } from 'resend'
const resend = new Resend(process.env.RESEND_API_KEY)

await resend.emails.send({
  from: process.env.EMAIL_FROM!,
  to: teamEmails,
  subject: `Grassion weekly: ${verdict === 'net_positive' ? '✅' : verdict === 'net_negative' ? '⚠️' : '➖'} Your AI ROI report`,
  text: weeklyDigestText(data),
})
```

---

## 12. Stripe Setup

1. Create Stripe account, toggle Test mode
2. Products → Create → **Grassion Starter** → Recurring $29/user/month → copy price ID
3. Store in `STRIPE_PRICE_ID_STARTER`
4. Set up webhook at `https://api.grassion.com/webhooks/stripe` for events: `customer.subscription.*`, `invoice.payment_*`

Checkout session code:
```typescript
const session = await stripe.checkout.sessions.create({
  mode: 'subscription',
  customer: team.stripeCustomerId,
  line_items: [{ price: process.env.STRIPE_PRICE_ID_STARTER, quantity: seatCount }],
  success_url: `${APP_URL}/billing?success=1`,
  cancel_url: `${APP_URL}/billing`,
  subscription_data: { trial_period_days: 14 },
})
```

---

## 13. Deployment (Fly.io + Neon + Vercel)

### Neon (Postgres)
1. Sign up at neon.tech
2. Create project `grassion`
3. Copy connection string → `DATABASE_URL`
4. Run migrations: `pnpm db:migrate`

### Fly.io (API + Worker)
```bash
# Install flyctl
brew install flyctl   # or curl -L https://fly.io/install.sh | sh
fly auth login

# Deploy API
cd apps/api
fly launch --name grassion-api --region bom  # Mumbai, close to you
fly secrets set DATABASE_URL=... GITHUB_APP_ID=... (all env vars)
fly deploy

# Deploy worker
cd ../worker
fly launch --name grassion-worker --region bom
fly secrets set DATABASE_URL=... RESEND_API_KEY=... (all env vars)
fly deploy
```

`apps/api/fly.toml`:
```toml
app = "grassion-api"
primary_region = "bom"
[build]
  dockerfile = "Dockerfile"
[http_service]
  internal_port = 3001
  force_https = true
  auto_stop_machines = false
  auto_start_machines = true
  min_machines_running = 1
[[vm]]
  cpu_kind = "shared"
  cpus = 1
  memory_mb = 256
```

`apps/api/Dockerfile`:
```dockerfile
FROM node:20-alpine
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @grassion/api build
EXPOSE 3001
CMD ["pnpm", "--filter", "@grassion/api", "start"]
```

### Vercel (Web)
```bash
cd apps/web
vercel link
vercel env add VITE_API_URL  # → https://api.grassion.com
vercel --prod
```

### DNS (Cloudflare, free)
1. Add grassion.com to Cloudflare (change nameservers at Hostinger)
2. Records:
   - `grassion.com` → Vercel (marketing site, if you build one) or 301 redirect to app
   - `app.grassion.com` → Vercel CNAME
   - `api.grassion.com` → Fly.io CNAME (`grassion-api.fly.dev`)

---

## 14. Six-Week Build Calendar

### Week 1 — Foundation
- [ ] Create repo, pnpm workspace, TypeScript config
- [ ] Create GitHub App on github.com (save credentials)
- [ ] Neon Postgres + Drizzle schema migration
- [ ] Express skeleton with `/health` and `/webhooks/github` endpoint
- [ ] Receive first webhook locally using `ngrok` or `smee.io`
- [ ] Deploy API skeleton to Fly.io
- [ ] Deploy empty web app to Vercel
- [ ] **Public post 1:** "Starting Grassion. Here's what and why."

### Week 2 — PR Ingestion + AI Detection
- [ ] Webhook handlers for `installation.*`, `pull_request.*`, `check_run.*`
- [ ] `detectAI()` function with trailer + label + body regex
- [ ] Backfill: on install, fetch last 60 days of PRs per repo via Octokit
- [ ] Unit tests for AI detection (target: detect Copilot + Claude trailers correctly)
- [ ] **Public post 2:** "Here's how I'm detecting AI-generated PRs. Code inside."

### Week 3 — Outcome Tracking + Dashboard v1
- [ ] Worker cron: outcome tracker (every 6h)
- [ ] Metrics computation (weekly)
- [ ] GitHub OAuth login flow
- [ ] Dashboard page with 4 stat cards + verdict badge + problem PRs list
- [ ] **Public post 3:** Dashboard screenshot on Twitter/LinkedIn

### Week 4 — Email Digest + Billing
- [ ] Resend integration + weekly digest email
- [ ] Stripe Checkout + Customer Portal
- [ ] Settings page (AI spend input, hourly rate, timezone)
- [ ] Onboarding flow (3 steps: install → connect repos → set AI spend)
- [ ] **Public post 4:** "Shipped billing. First 3 beta teams — free. DM if interested."

### Week 5 — Polish + Landing Page
- [ ] Marketing landing page at `grassion.com` (single page: hero + 3 features + pricing + FAQ)
- [ ] Error states, loading states, empty states
- [ ] Basic analytics (Plausible or Umami, both free-tier)
- [ ] Internal documentation for yourself
- [ ] **Public post 5:** Beta invite link

### Week 6 — Launch
- [ ] Show HN: "Show HN: Grassion — find out if your AI coding tools are worth it"
- [ ] Product Hunt scheduled launch
- [ ] Indie Hackers post
- [ ] DM 20 warm contacts (only now, not before)
- [ ] **Public posts 6 & 7:** launch day + day-after metrics

---

## 15. Non-Negotiable Rules

1. **Do not build features not listed in this spec until you have 10 paying customers.** Follow the ladder.
2. **No LLM calls in v1.** Your OpenAI key stays unused until month 4+.
3. **Post publicly 2x/week for 12 weeks.** That's the GTM. Non-negotiable.
4. **Ship weekly, even if ugly.** A broken dashboard in production beats a pretty one on localhost.
5. **Tell customers honestly what detection misses.** Don't fake precision.
6. **Charge from day 1 of public launch.** 14-day trial, then card required. Free forever = no signal.

---

## 16. What You'll Actually Tell Claude Code

Paste this into Claude Code as your first prompt (after creating empty repo):

> I'm building Grassion, a GitHub App that measures AI coding tool ROI for small teams. I have a complete build spec in GRASSION_BUILD_SPEC.md. Please read it, then set up the pnpm workspace structure, Drizzle schema, and Express skeleton with the GitHub webhook endpoint. Focus only on Week 1 deliverables. Don't build ahead. Ask me questions before making any architectural choice that isn't in the spec.

Then paste the spec file in. Claude Code will scaffold the whole thing.

---

**End of spec. Go ship, boss.**
