-- GitHub global IDs (repo IDs, PR IDs, user IDs) can exceed PostgreSQL INTEGER range (2.1B).
-- Widen to BIGINT so syncing recent repos doesn't throw "integer out of range".
ALTER TABLE repos ALTER COLUMN github_repo_id TYPE BIGINT;
ALTER TABLE pull_requests ALTER COLUMN github_pr_id TYPE BIGINT;
ALTER TABLE pull_requests ALTER COLUMN author_github_id TYPE BIGINT;
