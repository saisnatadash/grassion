-- Rename old weekly_snapshots columns to match the current schema, and add missing columns.
-- The 0002_odd_spectrum migration created the table with different column names than
-- what schema.ts now expects, causing every SELECT/INSERT on this table to fail.

DO $$ BEGIN
  ALTER TABLE "weekly_snapshots" RENAME COLUMN "adoption_pct" TO "ai_adoption_pct";
EXCEPTION WHEN undefined_column OR duplicate_column THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "weekly_snapshots" RENAME COLUMN "net_dollar_estimate" TO "net_roi_usd";
EXCEPTION WHEN undefined_column OR duplicate_column THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "weekly_snapshots" RENAME COLUMN "wasted_usd" TO "monthly_waste_usd";
EXCEPTION WHEN undefined_column OR duplicate_column THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "weekly_snapshots" ADD COLUMN IF NOT EXISTS "total_seats" integer DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "weekly_snapshots" ADD COLUMN IF NOT EXISTS "active_seats" integer DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "weekly_snapshots" ADD COLUMN IF NOT EXISTS "inactive_seats" integer DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "weekly_snapshots" ADD COLUMN IF NOT EXISTS "verdict" text;
