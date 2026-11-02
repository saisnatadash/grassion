-- Migration 0023: plan tier privacy controls
-- Adds teamOnlyMode and perDevMetricsEnabled to teams.
-- Valid plan values going forward: free | pro | business | enterprise
-- (trial | starter | growth remain in DB for existing rows; app logic maps them)

ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS team_only_mode       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS per_dev_metrics_enabled boolean NOT NULL DEFAULT false;
