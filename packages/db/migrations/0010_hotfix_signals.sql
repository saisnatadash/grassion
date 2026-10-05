ALTER TABLE "pr_outcomes" ADD COLUMN IF NOT EXISTS "hotfix_signals" jsonb DEFAULT '[]';
