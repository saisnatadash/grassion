-- Migration 0024: add slackTeamId to teams for per-workspace Slack scoping
-- Prevents cross-org data exposure in the /grassion slash command.

ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS slack_team_id text;
