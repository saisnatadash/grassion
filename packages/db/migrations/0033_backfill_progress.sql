-- Additive: progress tracking for HC backfill runs
ALTER TABLE hc_backfill_runs
  ADD COLUMN IF NOT EXISTS status_detail TEXT,
  ADD COLUMN IF NOT EXISTS progress_pct  INTEGER NOT NULL DEFAULT 0;
