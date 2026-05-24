CREATE TABLE IF NOT EXISTS "developer_weekly_metrics" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "team_id" uuid REFERENCES "public"."teams"("id") ON DELETE cascade,
  "github_login" text NOT NULL,
  "week_start" date NOT NULL,
  "total_prs" integer DEFAULT 0,
  "ai_prs" integer DEFAULT 0,
  "reverted_prs" integer DEFAULT 0,
  "hotfix_prs" integer DEFAULT 0,
  "avg_review_cycles" real DEFAULT 0,
  "avg_pr_size" integer DEFAULT 0,
  "ai_confidence_avg" real DEFAULT 0,
  "quality_score" real DEFAULT 0,
  "is_active" boolean DEFAULT false,
  "primary_ai_tool" text,
  "recorded_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "dev_metrics_team_login_week_idx" ON "developer_weekly_metrics" USING btree ("team_id","github_login","week_start");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dev_metrics_team_week" ON "developer_weekly_metrics" USING btree ("team_id","week_start");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "tool_weekly_metrics" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "team_id" uuid REFERENCES "public"."teams"("id") ON DELETE cascade,
  "tool_name" text NOT NULL,
  "week_start" date NOT NULL,
  "pr_count" integer DEFAULT 0,
  "revert_count" integer DEFAULT 0,
  "hotfix_count" integer DEFAULT 0,
  "avg_changes_requested" real DEFAULT 0,
  "quality_score" real DEFAULT 0,
  "estimated_spend_usd" real DEFAULT 0,
  "active_users" integer DEFAULT 0,
  "recorded_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tool_metrics_team_tool_week_idx" ON "tool_weekly_metrics" USING btree ("team_id","tool_name","week_start");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tool_metrics_team_week" ON "tool_weekly_metrics" USING btree ("team_id","week_start");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "codebase_health_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "team_id" uuid REFERENCES "public"."teams"("id") ON DELETE cascade,
  "snapshot_date" date NOT NULL,
  "overall_health_score" real DEFAULT 0,
  "ai_adoption_pct" real DEFAULT 0,
  "revert_rate_pct" real DEFAULT 0,
  "hotfix_rate_pct" real DEFAULT 0,
  "avg_pr_quality" real DEFAULT 0,
  "active_developers" integer DEFAULT 0,
  "total_developers" integer DEFAULT 0,
  "risk_level" text DEFAULT 'low',
  "created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "health_snapshots_team_date_idx" ON "codebase_health_snapshots" USING btree ("team_id","snapshot_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_health_team_date" ON "codebase_health_snapshots" USING btree ("team_id","snapshot_date");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "pr_risk_signals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "team_id" uuid REFERENCES "public"."teams"("id") ON DELETE cascade,
  "pull_request_id" uuid REFERENCES "public"."pull_requests"("id") ON DELETE cascade,
  "signal_type" text NOT NULL,
  "signal_value" real DEFAULT 0,
  "confidence" real DEFAULT 0,
  "description" text,
  "created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_risk_signals_pr" ON "pr_risk_signals" USING btree ("pull_request_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_risk_signals_team" ON "pr_risk_signals" USING btree ("team_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "engineering_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "team_id" uuid REFERENCES "public"."teams"("id") ON DELETE cascade,
  "event_type" text NOT NULL,
  "github_login" text,
  "metadata" jsonb DEFAULT '{}',
  "occurred_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_eng_events_team" ON "engineering_events" USING btree ("team_id","occurred_at");
