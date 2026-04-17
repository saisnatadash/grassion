import {
  pgTable,
  text,
  integer,
  timestamp,
  boolean,
  real,
  jsonb,
  uuid,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

// ============ TEAMS ============
export const teams = pgTable('teams', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  githubInstallationId: integer('github_installation_id').unique(),
  githubAccountLogin: text('github_account_login'),
  githubAccountType: text('github_account_type'),

  razorpayCustomerId: text('razorpay_customer_id').unique(),
  razorpaySubscriptionId: text('razorpay_subscription_id'),
  subscriptionStatus: text('subscription_status'),
  currentPeriodEnd: timestamp('current_period_end'),
  plan: text('plan').notNull().default('trial'),
  trialEndsAt: timestamp('trial_ends_at'),

  monthlyAiSpendUsd: real('monthly_ai_spend_usd').default(0),
  avgDevHourlyRateUsd: real('avg_dev_hourly_rate_usd').default(75),

  timezone: text('timezone').default('UTC'),
  emailDigestEnabled: boolean('email_digest_enabled').default(true),
  emailDigestDay: integer('email_digest_day').default(1),
  emailDigestHour: integer('email_digest_hour').default(9),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ============ USERS ============
export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .references(() => teams.id, { onDelete: 'cascade' })
      .notNull(),
    githubUserId: integer('github_user_id').notNull(),
    githubLogin: text('github_login').notNull(),
    email: text('email'),
    avatarUrl: text('avatar_url'),
    role: text('role').notNull().default('member'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    teamGhIdx: uniqueIndex('users_team_gh_idx').on(t.teamId, t.githubUserId),
  }),
)

// ============ REPOS ============
export const repos = pgTable('repos', {
  id: uuid('id').defaultRandom().primaryKey(),
  teamId: uuid('team_id')
    .references(() => teams.id, { onDelete: 'cascade' })
    .notNull(),
  githubRepoId: integer('github_repo_id').notNull().unique(),
  owner: text('owner').notNull(),
  name: text('name').notNull(),
  defaultBranch: text('default_branch').default('main'),
  isActive: boolean('is_active').default(true),
  connectedAt: timestamp('connected_at').defaultNow().notNull(),
  lastSyncedAt: timestamp('last_synced_at'),
})

// ============ PULL REQUESTS ============
export const pullRequests = pgTable(
  'pull_requests',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .references(() => teams.id, { onDelete: 'cascade' })
      .notNull(),
    repoId: uuid('repo_id')
      .references(() => repos.id, { onDelete: 'cascade' })
      .notNull(),

    githubPrId: integer('github_pr_id').notNull().unique(),
    githubPrNumber: integer('github_pr_number').notNull(),

    title: text('title').notNull(),
    state: text('state').notNull(),
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

    aiSource: text('ai_source'),
    aiDetectionMethod: text('ai_detection_method'),
    aiConfidence: real('ai_confidence').default(0),

    rawMetadata: jsonb('raw_metadata'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    teamMergedIdx: index('pr_team_merged_idx').on(t.teamId, t.mergedAt),
    teamAiIdx: index('pr_team_ai_idx').on(t.teamId, t.aiSource),
  }),
)

// ============ PR OUTCOMES ============
export const prOutcomes = pgTable(
  'pr_outcomes',
  {
    prId: uuid('pr_id')
      .references(() => pullRequests.id, { onDelete: 'cascade' })
      .primaryKey(),
    teamId: uuid('team_id')
      .references(() => teams.id, { onDelete: 'cascade' })
      .notNull(),

    wasReverted: boolean('was_reverted').default(false),
    revertedAt: timestamp('reverted_at'),
    revertPrNumber: integer('revert_pr_number'),

    ciFailureCount: integer('ci_failure_count').default(0),
    downstreamFixCount: integer('downstream_fix_count').default(0),
    downstreamFixPrNumbers: jsonb('downstream_fix_pr_numbers'),
    hadHotfixWithin7d: boolean('had_hotfix_within_7d').default(false),

    reworkScore: real('rework_score').default(0),

    aiSummary: text('ai_summary'),
    aiSummaryGeneratedAt: timestamp('ai_summary_generated_at'),

    computedAt: timestamp('computed_at').defaultNow().notNull(),
  },
  (t) => ({
    teamIdx: index('outcomes_team_idx').on(t.teamId),
  }),
)

// ============ LLM USAGE LOG ============
// Tracks OpenAI API usage so the worker can enforce a monthly USD budget cap.
export const llmUsageLog = pgTable(
  'llm_usage_log',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tokens: integer('tokens').notNull(),
    estimatedCostUsd: real('estimated_cost_usd').notNull(),
    purpose: text('purpose').default('pr_summary').notNull(),
    model: text('model'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    createdIdx: index('llm_usage_created_idx').on(t.createdAt),
  }),
)

// ============ WEEKLY METRICS CACHE ============
export const teamWeeklyMetrics = pgTable(
  'team_weekly_metrics',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .references(() => teams.id, { onDelete: 'cascade' })
      .notNull(),
    weekStart: timestamp('week_start').notNull(),

    totalPrs: integer('total_prs').default(0),
    aiPrs: integer('ai_prs').default(0),
    humanPrs: integer('human_prs').default(0),

    aiAvgMergeHours: real('ai_avg_merge_hours'),
    humanAvgMergeHours: real('human_avg_merge_hours'),
    aiReworkRate: real('ai_rework_rate'),
    humanReworkRate: real('human_rework_rate'),

    estimatedHoursSaved: real('estimated_hours_saved').default(0),
    estimatedHoursLost: real('estimated_hours_lost').default(0),
    estimatedDollarSaved: real('estimated_dollar_saved').default(0),
    estimatedDollarLost: real('estimated_dollar_lost').default(0),

    verdict: text('verdict'),

    computedAt: timestamp('computed_at').defaultNow().notNull(),
  },
  (t) => ({
    teamWeekIdx: uniqueIndex('metrics_team_week_idx').on(t.teamId, t.weekStart),
  }),
)

// ============ AUTH SESSIONS ============
export const sessions = pgTable('sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// ============ EMAIL DIGEST LOG ============
export const emailDigests = pgTable('email_digests', {
  id: uuid('id').defaultRandom().primaryKey(),
  teamId: uuid('team_id')
    .references(() => teams.id, { onDelete: 'cascade' })
    .notNull(),
  sentAt: timestamp('sent_at').defaultNow().notNull(),
  weekStart: timestamp('week_start').notNull(),
  recipientCount: integer('recipient_count'),
  status: text('status'),
  errorMessage: text('error_message'),
})

// ============ OUTCOME CHECK QUEUE ============
// Schedules a deferred outcome computation for a merged PR.
export const outcomeCheckQueue = pgTable(
  'outcome_check_queue',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    prId: uuid('pr_id')
      .references(() => pullRequests.id, { onDelete: 'cascade' })
      .notNull(),
    runAfter: timestamp('run_after').notNull(),
    completedAt: timestamp('completed_at'),
    attempts: integer('attempts').default(0),
    lastError: text('last_error'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    runAfterIdx: index('outcome_queue_run_after_idx').on(t.runAfter, t.completedAt),
    prIdx: uniqueIndex('outcome_queue_pr_idx').on(t.prId),
  }),
)

// ============ RELATIONS ============
export const teamsRelations = relations(teams, ({ many }) => ({
  users: many(users),
  repos: many(repos),
  pullRequests: many(pullRequests),
  weeklyMetrics: many(teamWeeklyMetrics),
}))

export const usersRelations = relations(users, ({ one, many }) => ({
  team: one(teams, { fields: [users.teamId], references: [teams.id] }),
  sessions: many(sessions),
}))

export const reposRelations = relations(repos, ({ one, many }) => ({
  team: one(teams, { fields: [repos.teamId], references: [teams.id] }),
  pullRequests: many(pullRequests),
}))

export const pullRequestsRelations = relations(pullRequests, ({ one }) => ({
  team: one(teams, { fields: [pullRequests.teamId], references: [teams.id] }),
  repo: one(repos, { fields: [pullRequests.repoId], references: [repos.id] }),
  outcome: one(prOutcomes, { fields: [pullRequests.id], references: [prOutcomes.prId] }),
}))

export const prOutcomesRelations = relations(prOutcomes, ({ one }) => ({
  pr: one(pullRequests, { fields: [prOutcomes.prId], references: [pullRequests.id] }),
  team: one(teams, { fields: [prOutcomes.teamId], references: [teams.id] }),
}))

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}))

// ============ INFERRED TYPES ============
export type Team = typeof teams.$inferSelect
export type NewTeam = typeof teams.$inferInsert
export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type Repo = typeof repos.$inferSelect
export type NewRepo = typeof repos.$inferInsert
export type PullRequest = typeof pullRequests.$inferSelect
export type NewPullRequest = typeof pullRequests.$inferInsert
export type PrOutcome = typeof prOutcomes.$inferSelect
export type NewPrOutcome = typeof prOutcomes.$inferInsert
export type TeamWeeklyMetric = typeof teamWeeklyMetrics.$inferSelect
export type NewTeamWeeklyMetric = typeof teamWeeklyMetrics.$inferInsert
export type Session = typeof sessions.$inferSelect
export type NewSession = typeof sessions.$inferInsert
export type EmailDigest = typeof emailDigests.$inferSelect
export type NewEmailDigest = typeof emailDigests.$inferInsert
export type OutcomeCheckQueueRow = typeof outcomeCheckQueue.$inferSelect
export type NewOutcomeCheckQueueRow = typeof outcomeCheckQueue.$inferInsert
export type LlmUsageLogRow = typeof llmUsageLog.$inferSelect
export type NewLlmUsageLogRow = typeof llmUsageLog.$inferInsert
