-- Add checkpoint_days to outcome_check_queue and replace the per-PR unique index
-- with a composite (pr_id, checkpoint_days) so three rows can exist per PR.
ALTER TABLE "outcome_check_queue" ADD COLUMN IF NOT EXISTS "checkpoint_days" integer DEFAULT 7;

DROP INDEX IF EXISTS "outcome_queue_pr_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "outcome_queue_pr_checkpoint_idx"
  ON "outcome_check_queue" ("pr_id", "checkpoint_days");

-- Permanent decay timeline: one row per PR per checkpoint (7 / 14 / 30 days).
CREATE TABLE IF NOT EXISTS "pr_outcome_timeline" (
  "id" uuid DEFAULT gen_random_uuid() PRIMARY KEY NOT NULL,
  "pr_id" uuid NOT NULL REFERENCES "pull_requests"("id") ON DELETE CASCADE,
  "team_id" uuid NOT NULL REFERENCES "teams"("id") ON DELETE CASCADE,
  "checkpoint_days" integer NOT NULL,
  "rework_score" real DEFAULT 0,
  "was_reverted" boolean DEFAULT false,
  "ci_failure_count" integer DEFAULT 0,
  "downstream_fix_count" integer DEFAULT 0,
  "had_hotfix" boolean DEFAULT false,
  "hotfix_signals" jsonb DEFAULT '[]',
  "dollar_impact" real DEFAULT 0,
  "computed_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "pr_outcome_timeline_pr_checkpoint_idx"
  ON "pr_outcome_timeline" ("pr_id", "checkpoint_days");
CREATE INDEX IF NOT EXISTS "pr_outcome_timeline_team_idx"
  ON "pr_outcome_timeline" ("team_id");
