-- Add team_id, input_tokens, output_tokens to llm_usage_log for per-team daily cap enforcement.
ALTER TABLE llm_usage_log ADD COLUMN IF NOT EXISTS team_id uuid REFERENCES teams(id) ON DELETE SET NULL;
ALTER TABLE llm_usage_log ADD COLUMN IF NOT EXISTS input_tokens integer;
ALTER TABLE llm_usage_log ADD COLUMN IF NOT EXISTS output_tokens integer;

CREATE INDEX IF NOT EXISTS llm_usage_team_created_idx ON llm_usage_log(team_id, created_at);
