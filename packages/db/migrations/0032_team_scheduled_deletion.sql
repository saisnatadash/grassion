-- Tracks when a team is scheduled for deletion after GitHub App uninstall.
-- NULL = active team. Retention job deletes teams where this timestamp has passed.
ALTER TABLE teams ADD COLUMN IF NOT EXISTS scheduled_deletion_at timestamptz;

CREATE INDEX IF NOT EXISTS teams_scheduled_deletion_idx ON teams (scheduled_deletion_at)
  WHERE scheduled_deletion_at IS NOT NULL;
