CREATE TABLE IF NOT EXISTS "developer_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"github_login" text NOT NULL,
	"week_start" timestamp NOT NULL,
	"ai_pr_count" integer DEFAULT 0,
	"total_pr_count" integer DEFAULT 0,
	"is_active" boolean DEFAULT false,
	"computed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "savings_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"inactive_count" integer NOT NULL,
	"monthly_waste_usd" real NOT NULL,
	"detected_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "team_milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"milestone" text NOT NULL,
	"achieved_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "weekly_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"week_start" timestamp NOT NULL,
	"ai_prs" integer DEFAULT 0,
	"total_prs" integer DEFAULT 0,
	"adoption_pct" real DEFAULT 0,
	"net_dollar_estimate" real DEFAULT 0,
	"wasted_usd" real DEFAULT 0,
	"computed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "last_digest_sent_at" timestamp;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "developer_history" ADD CONSTRAINT "developer_history_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "savings_events" ADD CONSTRAINT "savings_events_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "team_milestones" ADD CONSTRAINT "team_milestones_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "weekly_snapshots" ADD CONSTRAINT "weekly_snapshots_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "dev_history_team_login_week_idx" ON "developer_history" USING btree ("team_id","github_login","week_start");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "savings_events_team_idx" ON "savings_events" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "savings_events_team_date_idx" ON "savings_events" USING btree ("team_id","detected_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "team_milestones_team_milestone_idx" ON "team_milestones" USING btree ("team_id","milestone");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "weekly_snapshots_team_week_idx" ON "weekly_snapshots" USING btree ("team_id","week_start");