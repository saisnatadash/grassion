CREATE TABLE IF NOT EXISTS "email_digests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"sent_at" timestamp DEFAULT now() NOT NULL,
	"week_start" timestamp NOT NULL,
	"recipient_count" integer,
	"status" text,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "llm_usage_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tokens" integer NOT NULL,
	"estimated_cost_usd" real NOT NULL,
	"purpose" text DEFAULT 'pr_summary' NOT NULL,
	"model" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "outcome_check_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pr_id" uuid NOT NULL,
	"run_after" timestamp NOT NULL,
	"completed_at" timestamp,
	"attempts" integer DEFAULT 0,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pr_outcomes" (
	"pr_id" uuid PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"was_reverted" boolean DEFAULT false,
	"reverted_at" timestamp,
	"revert_pr_number" integer,
	"ci_failure_count" integer DEFAULT 0,
	"downstream_fix_count" integer DEFAULT 0,
	"downstream_fix_pr_numbers" jsonb,
	"had_hotfix_within_7d" boolean DEFAULT false,
	"rework_score" real DEFAULT 0,
	"ai_summary" text,
	"ai_summary_generated_at" timestamp,
	"computed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pull_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"repo_id" uuid NOT NULL,
	"github_pr_id" integer NOT NULL,
	"github_pr_number" integer NOT NULL,
	"title" text NOT NULL,
	"state" text NOT NULL,
	"author_github_id" integer,
	"author_login" text,
	"opened_at" timestamp NOT NULL,
	"merged_at" timestamp,
	"closed_at" timestamp,
	"merge_commit_sha" text,
	"additions" integer DEFAULT 0,
	"deletions" integer DEFAULT 0,
	"changed_files" integer DEFAULT 0,
	"commit_count" integer DEFAULT 0,
	"ai_source" text,
	"ai_detection_method" text,
	"ai_confidence" real DEFAULT 0,
	"raw_metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "pull_requests_github_pr_id_unique" UNIQUE("github_pr_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "repos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"github_repo_id" integer NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"default_branch" text DEFAULT 'main',
	"is_active" boolean DEFAULT true,
	"connected_at" timestamp DEFAULT now() NOT NULL,
	"last_synced_at" timestamp,
	CONSTRAINT "repos_github_repo_id_unique" UNIQUE("github_repo_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "team_weekly_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"week_start" timestamp NOT NULL,
	"total_prs" integer DEFAULT 0,
	"ai_prs" integer DEFAULT 0,
	"human_prs" integer DEFAULT 0,
	"ai_avg_merge_hours" real,
	"human_avg_merge_hours" real,
	"ai_rework_rate" real,
	"human_rework_rate" real,
	"estimated_hours_saved" real DEFAULT 0,
	"estimated_hours_lost" real DEFAULT 0,
	"estimated_dollar_saved" real DEFAULT 0,
	"estimated_dollar_lost" real DEFAULT 0,
	"verdict" text,
	"computed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"github_installation_id" integer,
	"github_account_login" text,
	"github_account_type" text,
	"razorpay_customer_id" text,
	"razorpay_subscription_id" text,
	"subscription_status" text,
	"current_period_end" timestamp,
	"plan" text DEFAULT 'trial' NOT NULL,
	"trial_ends_at" timestamp,
	"monthly_ai_spend_usd" real DEFAULT 0,
	"avg_dev_hourly_rate_usd" real DEFAULT 75,
	"timezone" text DEFAULT 'UTC',
	"email_digest_enabled" boolean DEFAULT true,
	"email_digest_day" integer DEFAULT 1,
	"email_digest_hour" integer DEFAULT 9,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "teams_slug_unique" UNIQUE("slug"),
	CONSTRAINT "teams_github_installation_id_unique" UNIQUE("github_installation_id"),
	CONSTRAINT "teams_razorpay_customer_id_unique" UNIQUE("razorpay_customer_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"github_user_id" integer NOT NULL,
	"github_login" text NOT NULL,
	"email" text,
	"avatar_url" text,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_digests" ADD CONSTRAINT "email_digests_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outcome_check_queue" ADD CONSTRAINT "outcome_check_queue_pr_id_pull_requests_id_fk" FOREIGN KEY ("pr_id") REFERENCES "public"."pull_requests"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pr_outcomes" ADD CONSTRAINT "pr_outcomes_pr_id_pull_requests_id_fk" FOREIGN KEY ("pr_id") REFERENCES "public"."pull_requests"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pr_outcomes" ADD CONSTRAINT "pr_outcomes_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "repos" ADD CONSTRAINT "repos_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "team_weekly_metrics" ADD CONSTRAINT "team_weekly_metrics_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "users" ADD CONSTRAINT "users_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "llm_usage_created_idx" ON "llm_usage_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outcome_queue_run_after_idx" ON "outcome_check_queue" USING btree ("run_after","completed_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "outcome_queue_pr_idx" ON "outcome_check_queue" USING btree ("pr_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outcomes_team_idx" ON "pr_outcomes" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pr_team_merged_idx" ON "pull_requests" USING btree ("team_id","merged_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pr_team_ai_idx" ON "pull_requests" USING btree ("team_id","ai_source");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "metrics_team_week_idx" ON "team_weekly_metrics" USING btree ("team_id","week_start");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_team_gh_idx" ON "users" USING btree ("team_id","github_user_id");