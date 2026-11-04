-- Mark pr_outcomes rows whose hotfix flag was set solely by the off_hours signal.
-- Off-hours alone is no longer a valid hotfix signal — a strong signal is now required.
UPDATE pr_outcomes
SET had_hotfix_within_7d = false
WHERE had_hotfix_within_7d = true
  AND hotfix_signals IS NOT NULL
  AND hotfix_signals @> '["off_hours"]'::jsonb
  AND jsonb_array_length(hotfix_signals) = 1;
