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
  date,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

// ============ REFERRAL CODES ============
export const referralCodes = pgTable('referral_codes', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: text('code').notNull().unique(),
  partnerName: text('partner_name').notNull(),
  partnerEmail: text('partner_email').notNull(),
  commissionPct: real('commission_pct').default(20.0),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// ============ TEAMS ============
export const teams = pgTable('teams', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  githubInstallationId: integer('github_installation_id').unique(),
  githubAccountLogin: text('github_account_login'),
  githubAccountType: text('github_account_type'),
  // Owner's GitHub OAuth access token — fallback auth for repo listing/connect
  // when the App installation webhook hasn't arrived (or the App isn't installed).
  githubOauthToken: text('github_oauth_token'),

  razorpayCustomerId: text('razorpay_customer_id').unique(),
  razorpaySubscriptionId: text('razorpay_subscription_id'),
  subscriptionStatus: text('subscription_status'),
  currentPeriodEnd: timestamp('current_period_end'),
  plan: text('plan').notNull().default('trial'),
  trialEndsAt: timestamp('trial_ends_at'),

  monthlyAiSpendUsd: real('monthly_ai_spend_usd').default(0),
  avgDevHourlyRateUsd: real('avg_dev_hourly_rate_usd').default(75),
  perSeatCostUsd: real('per_seat_cost_usd').default(19),
  toolSeatCosts: jsonb('tool_seat_costs').default({}).$type<Record<string, number>>(),

  referralCode: text('referral_code'),
  referralCodeId: uuid('referral_code_id').references(() => referralCodes.id),

  timezone: text('timezone').default('UTC'),
  emailDigestEnabled: boolean('email_digest_enabled').default(true),
  emailDigestDay: integer('email_digest_day').default(1),
  emailDigestHour: integer('email_digest_hour').default(9),

  lastDigestSentAt: timestamp('last_digest_sent_at'),

  slackWebhookUrl: text('slack_webhook_url'),

  benchmarkingOptIn: boolean('benchmarking_opt_in').default(false),
  teamSizeRange: text('team_size_range'),
  industry: text('industry'),

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

    reviewCount: integer('review_count').default(0),
    changesRequestedCount: integer('changes_requested_count').default(0),
    wasReverted: boolean('was_reverted').default(false),
    triggeredHotfix: boolean('triggered_hotfix').default(false),

    rawMetadata: jsonb('raw_metadata'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    teamMergedIdx: index('pr_team_merged_idx').on(t.teamId, t.mergedAt),
    teamAiIdx: index('pr_team_ai_idx').on(t.teamId, t.aiSource),
    repoStateMergedIdx: index('pr_repo_state_merged_idx').on(t.repoId, t.state, t.mergedAt),
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
    hotfixSignals: jsonb('hotfix_signals').default([]).$type<string[]>(),

    reworkScore: real('rework_score').default(0),

    aiSummary: text('ai_summary'),
    aiSummaryGeneratedAt: timestamp('ai_summary_generated_at'),

    computedAt: timestamp('computed_at').defaultNow().notNull(),
  },
  (t) => ({
    teamIdx: index('outcomes_team_idx').on(t.teamId),
    teamComputedIdx: index('outcomes_team_computed_idx').on(t.teamId, t.computedAt),
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
// Three rows per PR — one per checkpoint (7, 14, 30 days after merge).
export const outcomeCheckQueue = pgTable(
  'outcome_check_queue',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    prId: uuid('pr_id')
      .references(() => pullRequests.id, { onDelete: 'cascade' })
      .notNull(),
    checkpointDays: integer('checkpoint_days').default(7),
    runAfter: timestamp('run_after').notNull(),
    completedAt: timestamp('completed_at'),
    attempts: integer('attempts').default(0),
    lastError: text('last_error'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    runAfterIdx: index('outcome_queue_run_after_idx').on(t.runAfter, t.completedAt),
    prCheckpointIdx: uniqueIndex('outcome_queue_pr_checkpoint_idx').on(t.prId, t.checkpointDays),
  }),
)

// ============ PR OUTCOME TIMELINE ============
// Permanent record of outcome signals at each checkpoint (7, 14, 30 days post-merge).
export const prOutcomeTimeline = pgTable(
  'pr_outcome_timeline',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    prId: uuid('pr_id')
      .references(() => pullRequests.id, { onDelete: 'cascade' })
      .notNull(),
    teamId: uuid('team_id')
      .references(() => teams.id, { onDelete: 'cascade' })
      .notNull(),
    checkpointDays: integer('checkpoint_days').notNull(),
    reworkScore: real('rework_score').default(0),
    wasReverted: boolean('was_reverted').default(false),
    ciFailureCount: integer('ci_failure_count').default(0),
    downstreamFixCount: integer('downstream_fix_count').default(0),
    hadHotfix: boolean('had_hotfix').default(false),
    hotfixSignals: jsonb('hotfix_signals').default([]).$type<string[]>(),
    dollarImpact: real('dollar_impact').default(0),
    computedAt: timestamp('computed_at').defaultNow().notNull(),
  },
  (t) => ({
    prCheckpointIdx: uniqueIndex('pr_outcome_timeline_pr_checkpoint_idx').on(t.prId, t.checkpointDays),
    teamIdx: index('pr_outcome_timeline_team_idx').on(t.teamId),
  }),
)

// ============ INDUSTRY BENCHMARKS ============
// Aggregate p25/p50/p75 values computed from opt-in teams. Rows expire after 30 days.
export const industryBenchmarks = pgTable(
  'industry_benchmarks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    toolName: text('tool_name').notNull(),
    teamSizeRange: text('team_size_range').notNull(),
    industry: text('industry').default('all').notNull(),
    metricName: text('metric_name').notNull(),
    p25Value: real('p25_value'),
    p50Value: real('p50_value'),
    p75Value: real('p75_value'),
    sampleSize: integer('sample_size'),
    computedAt: timestamp('computed_at').defaultNow().notNull(),
    validUntil: timestamp('valid_until').notNull(),
  },
  (t) => ({
    toolMetricIdx: index('benchmarks_tool_metric_idx').on(t.toolName, t.metricName),
    sizeIndustryIdx: index('benchmarks_size_industry_idx').on(t.teamSizeRange, t.industry),
  }),
)

// ============ TEAM BENCHMARK CONTRIBUTIONS ============
// Records which teams contributed data to each benchmark computation.
export const teamBenchmarkContributions = pgTable(
  'team_benchmark_contributions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .references(() => teams.id, { onDelete: 'cascade' })
      .notNull(),
    benchmarkId: uuid('benchmark_id')
      .references(() => industryBenchmarks.id, { onDelete: 'cascade' })
      .notNull(),
    contributedAt: timestamp('contributed_at').defaultNow().notNull(),
  },
  (t) => ({
    teamBenchmarkIdx: uniqueIndex('team_benchmark_contributions_team_benchmark_idx').on(t.teamId, t.benchmarkId),
  }),
)

// ============ AUDIT LOGS ============
// Immutable SOC2-aligned record of security-relevant user actions.
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id').references(() => teams.id, { onDelete: 'set null' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    resourceType: text('resource_type'),
    resourceId: text('resource_id'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    metadata: jsonb('metadata').default({}).$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    teamCreatedIdx: index('audit_logs_team_created_idx').on(t.teamId, t.createdAt),
    actionCreatedIdx: index('audit_logs_action_created_idx').on(t.action, t.createdAt),
  }),
)

// ============ SAVINGS EVENTS ============
// Logged once per ~6h when inactive seats are detected; powers the Savings Unlocked dashboard card.
export const savingsEvents = pgTable(
  'savings_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .references(() => teams.id, { onDelete: 'cascade' })
      .notNull(),
    inactiveCount: integer('inactive_count').notNull(),
    monthlyWasteUsd: real('monthly_waste_usd').notNull(),
    detectedAt: timestamp('detected_at').defaultNow().notNull(),
  },
  (t) => ({
    teamIdx: index('savings_events_team_idx').on(t.teamId),
    teamDateIdx: index('savings_events_team_date_idx').on(t.teamId, t.detectedAt),
  }),
)

// ============ CONTACT SUBMISSIONS ============
export const contactSubmissions = pgTable('contact_submissions', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  topic: text('topic').notNull(),
  message: text('message').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// ============ WEEKLY SNAPSHOTS ============
// Permanent record of each calendar week's metrics — never deleted or overwritten.
export const weeklySnapshots = pgTable(
  'weekly_snapshots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .references(() => teams.id, { onDelete: 'cascade' })
      .notNull(),
    weekStart: timestamp('week_start').notNull(),
    totalSeats: integer('total_seats').default(0),
    activeSeats: integer('active_seats').default(0),
    inactiveSeats: integer('inactive_seats').default(0),
    aiPrs: integer('ai_prs').default(0),
    totalPrs: integer('total_prs').default(0),
    aiAdoptionPct: real('ai_adoption_pct').default(0),
    monthlyWasteUsd: real('monthly_waste_usd').default(0),
    netRoiUsd: real('net_roi_usd').default(0),
    verdict: text('verdict'),
    computedAt: timestamp('computed_at').defaultNow().notNull(),
  },
  (t) => ({
    teamWeekIdx: uniqueIndex('weekly_snapshots_team_week_idx').on(t.teamId, t.weekStart),
  }),
)

// ============ DEVELOPER HISTORY ============
// Per-developer, per-week AI usage — permanent record, one row per login per week.
export const developerHistory = pgTable(
  'developer_history',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .references(() => teams.id, { onDelete: 'cascade' })
      .notNull(),
    githubLogin: text('github_login').notNull(),
    weekStart: timestamp('week_start').notNull(),
    aiPrCount: integer('ai_pr_count').default(0),
    totalPrCount: integer('total_pr_count').default(0),
    isActive: boolean('is_active').default(false),
    computedAt: timestamp('computed_at').defaultNow().notNull(),
  },
  (t) => ({
    teamLoginWeekIdx: uniqueIndex('dev_history_team_login_week_idx').on(t.teamId, t.githubLogin, t.weekStart),
  }),
)

// ============ TEAM MILESTONES ============
// Milestone events — one row per milestone per team, recorded once and never deleted.
export const teamMilestones = pgTable(
  'team_milestones',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .references(() => teams.id, { onDelete: 'cascade' })
      .notNull(),
    milestone: text('milestone').notNull(),
    achievedAt: timestamp('achieved_at').defaultNow().notNull(),
  },
  (t) => ({
    teamMilestoneIdx: uniqueIndex('team_milestones_team_milestone_idx').on(t.teamId, t.milestone),
  }),
)

// ============ NOTIFICATIONS ============
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .references(() => teams.id, { onDelete: 'cascade' })
      .notNull(),
    type: text('type').notNull(), // 'revert_detected' | 'problem_pr' | 'hotfix_surge'
    title: text('title').notNull(),
    body: text('body').notNull(),
    link: text('link'),
    sourceId: text('source_id'), // prId that triggered this — used for dedup
    readAt: timestamp('read_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    teamIdx: index('notifications_team_idx').on(t.teamId),
    sourceUniqueIdx: uniqueIndex('notifications_team_type_source_idx').on(t.teamId, t.type, t.sourceId),
  }),
)

export type Notification = typeof notifications.$inferSelect
export type NewNotification = typeof notifications.$inferInsert

// ============ DEVELOPER WEEKLY METRICS ============
export const developerWeeklyMetrics = pgTable(
  'developer_weekly_metrics',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id').references(() => teams.id, { onDelete: 'cascade' }),
    githubLogin: text('github_login').notNull(),
    weekStart: date('week_start').notNull(),
    totalPrs: integer('total_prs').default(0),
    aiPrs: integer('ai_prs').default(0),
    revertedPrs: integer('reverted_prs').default(0),
    hotfixPrs: integer('hotfix_prs').default(0),
    avgReviewCycles: real('avg_review_cycles').default(0),
    avgPrSize: integer('avg_pr_size').default(0),
    aiConfidenceAvg: real('ai_confidence_avg').default(0),
    qualityScore: real('quality_score').default(0),
    isActive: boolean('is_active').default(false),
    primaryAiTool: text('primary_ai_tool'),
    recordedAt: timestamp('recorded_at').defaultNow(),
  },
  (t) => ({
    teamWeekIdx: index('idx_dev_metrics_team_week').on(t.teamId, t.weekStart),
    uniqueIdx: uniqueIndex('dev_metrics_team_login_week_idx').on(t.teamId, t.githubLogin, t.weekStart),
  }),
)

// ============ TOOL WEEKLY METRICS ============
export const toolWeeklyMetrics = pgTable(
  'tool_weekly_metrics',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id').references(() => teams.id, { onDelete: 'cascade' }),
    toolName: text('tool_name').notNull(),
    weekStart: date('week_start').notNull(),
    prCount: integer('pr_count').default(0),
    revertCount: integer('revert_count').default(0),
    hotfixCount: integer('hotfix_count').default(0),
    avgChangesRequested: real('avg_changes_requested').default(0),
    qualityScore: real('quality_score').default(0),
    estimatedSpendUsd: real('estimated_spend_usd').default(0),
    activeUsers: integer('active_users').default(0),
    recordedAt: timestamp('recorded_at').defaultNow(),
  },
  (t) => ({
    teamWeekIdx: index('idx_tool_metrics_team_week').on(t.teamId, t.weekStart),
    uniqueIdx: uniqueIndex('tool_metrics_team_tool_week_idx').on(t.teamId, t.toolName, t.weekStart),
  }),
)

// ============ CODEBASE HEALTH SNAPSHOTS ============
export const codbaseHealthSnapshots = pgTable(
  'codebase_health_snapshots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id').references(() => teams.id, { onDelete: 'cascade' }),
    snapshotDate: date('snapshot_date').notNull(),
    overallHealthScore: real('overall_health_score').default(0),
    aiAdoptionPct: real('ai_adoption_pct').default(0),
    revertRatePct: real('revert_rate_pct').default(0),
    hotfixRatePct: real('hotfix_rate_pct').default(0),
    avgPrQuality: real('avg_pr_quality').default(0),
    activeDevelopers: integer('active_developers').default(0),
    totalDevelopers: integer('total_developers').default(0),
    riskLevel: text('risk_level').default('low'),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (t) => ({
    teamDateIdx: index('idx_health_team_date').on(t.teamId, t.snapshotDate),
    uniqueIdx: uniqueIndex('health_snapshots_team_date_idx').on(t.teamId, t.snapshotDate),
  }),
)

// ============ PR RISK SIGNALS ============
export const prRiskSignals = pgTable(
  'pr_risk_signals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id').references(() => teams.id, { onDelete: 'cascade' }),
    pullRequestId: uuid('pull_request_id').references(() => pullRequests.id, { onDelete: 'cascade' }),
    signalType: text('signal_type').notNull(),
    signalValue: real('signal_value').default(0),
    confidence: real('confidence').default(0),
    description: text('description'),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (t) => ({
    prIdx: index('idx_risk_signals_pr').on(t.pullRequestId),
    teamIdx: index('idx_risk_signals_team').on(t.teamId),
  }),
)

// ============ ENGINEERING EVENTS ============
export const engineeringEvents = pgTable(
  'engineering_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id').references(() => teams.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    githubLogin: text('github_login'),
    metadata: jsonb('metadata').default({}),
    occurredAt: timestamp('occurred_at').defaultNow(),
  },
  (t) => ({
    teamDateIdx: index('idx_eng_events_team').on(t.teamId, t.occurredAt),
  }),
)

// ============ WEBHOOK EVENTS (idempotency) ============
// One row per X-Github-Delivery ID. INSERT ... ON CONFLICT DO NOTHING prevents
// duplicate processing when GitHub retries a delivery.
export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    githubDeliveryId: text('github_delivery_id').notNull().unique(),
    receivedAt: timestamp('received_at').defaultNow().notNull(),
    processed: boolean('processed').default(false).notNull(),
  },
  (t) => ({
    deliveryIdx: uniqueIndex('webhook_events_delivery_idx').on(t.githubDeliveryId),
  }),
)

export type WebhookEvent = typeof webhookEvents.$inferSelect
export type NewWebhookEvent = typeof webhookEvents.$inferInsert

// ============ REFERRAL CONVERSIONS ============
// One row per team-per-code. ON CONFLICT DO NOTHING prevents double-counting
// when both the checkout verify endpoint and the Razorpay webhook fire.
export const referralConversions = pgTable(
  'referral_conversions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    referralCodeId: uuid('referral_code_id')
      .references(() => referralCodes.id)
      .notNull(),
    teamId: uuid('team_id')
      .references(() => teams.id, { onDelete: 'cascade' })
      .notNull(),
    convertedAt: timestamp('converted_at').defaultNow().notNull(),
    planAtConversion: text('plan_at_conversion').notNull(),
    mrrUsd: real('mrr_usd').notNull(),
    commissionUsd: real('commission_usd').notNull(),
  },
  (t) => ({
    uniqueIdx: uniqueIndex('referral_conversions_code_team_idx').on(t.referralCodeId, t.teamId),
  }),
)

export type ReferralCode = typeof referralCodes.$inferSelect
export type NewReferralCode = typeof referralCodes.$inferInsert
export type ReferralConversion = typeof referralConversions.$inferSelect
export type NewReferralConversion = typeof referralConversions.$inferInsert

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
export type ContactSubmission = typeof contactSubmissions.$inferSelect
export type NewContactSubmission = typeof contactSubmissions.$inferInsert
export type SavingsEvent = typeof savingsEvents.$inferSelect
export type NewSavingsEvent = typeof savingsEvents.$inferInsert
export type WeeklySnapshot = typeof weeklySnapshots.$inferSelect
export type NewWeeklySnapshot = typeof weeklySnapshots.$inferInsert

export type DeveloperHistoryRow = typeof developerHistory.$inferSelect
export type NewDeveloperHistoryRow = typeof developerHistory.$inferInsert
export type TeamMilestone = typeof teamMilestones.$inferSelect
export type NewTeamMilestone = typeof teamMilestones.$inferInsert

export type DeveloperWeeklyMetric = typeof developerWeeklyMetrics.$inferSelect
export type NewDeveloperWeeklyMetric = typeof developerWeeklyMetrics.$inferInsert
export type ToolWeeklyMetric = typeof toolWeeklyMetrics.$inferSelect
export type NewToolWeeklyMetric = typeof toolWeeklyMetrics.$inferInsert
export type CodebaseHealthSnapshot = typeof codbaseHealthSnapshots.$inferSelect
export type NewCodebaseHealthSnapshot = typeof codbaseHealthSnapshots.$inferInsert
export type PrRiskSignal = typeof prRiskSignals.$inferSelect
export type NewPrRiskSignal = typeof prRiskSignals.$inferInsert
export type EngineeringEvent = typeof engineeringEvents.$inferSelect
export type NewEngineeringEvent = typeof engineeringEvents.$inferInsert
export type PrOutcomeTimelineRow = typeof prOutcomeTimeline.$inferSelect
export type NewPrOutcomeTimelineRow = typeof prOutcomeTimeline.$inferInsert
export type AuditLog = typeof auditLogs.$inferSelect
export type NewAuditLog = typeof auditLogs.$inferInsert
export type IndustryBenchmark = typeof industryBenchmarks.$inferSelect
export type NewIndustryBenchmark = typeof industryBenchmarks.$inferInsert
export type TeamBenchmarkContribution = typeof teamBenchmarkContributions.$inferSelect
export type NewTeamBenchmarkContribution = typeof teamBenchmarkContributions.$inferInsert
