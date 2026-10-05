-- Index for outcome tracker queries: findRevertPR and findDownstreamFixPRs both
-- filter on (repoId, state, mergedAt). Without this, Postgres does a full table
-- scan on pull_requests for every PR being checked.
CREATE INDEX IF NOT EXISTS "pr_repo_state_merged_idx"
  ON "pull_requests" ("repo_id", "state", "merged_at");

-- Index to speed up dashboard queries that sort/filter prOutcomes by team and time.
CREATE INDEX IF NOT EXISTS "outcomes_team_computed_idx"
  ON "pr_outcomes" ("team_id", "computed_at");
