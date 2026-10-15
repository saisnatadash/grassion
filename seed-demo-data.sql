-- ============================================================
-- Grassion demo seed data
-- Run this in Neon / Supabase SQL editor.
-- Replace YOUR_TEAM_ID below with your actual team UUID
-- (find it: SELECT id, name FROM teams LIMIT 5;)
-- ============================================================

DO $$
DECLARE
  v_team_id   UUID := '00000000-0000-0000-0000-000000000000'; -- ← REPLACE THIS
  v_repo_id   UUID;
  v_base      BIGINT := 700000001;

  -- week helper
  w0  TIMESTAMPTZ := date_trunc('week', NOW() AT TIME ZONE 'UTC');
  w1  TIMESTAMPTZ := w0 - INTERVAL '1 week';
  w2  TIMESTAMPTZ := w0 - INTERVAL '2 weeks';
  w3  TIMESTAMPTZ := w0 - INTERVAL '3 weeks';
  w4  TIMESTAMPTZ := w0 - INTERVAL '4 weeks';
  w5  TIMESTAMPTZ := w0 - INTERVAL '5 weeks';
  w6  TIMESTAMPTZ := w0 - INTERVAL '6 weeks';
  w7  TIMESTAMPTZ := w0 - INTERVAL '7 weeks';
BEGIN

-- ── 0. Safety check ──────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM teams WHERE id = v_team_id) THEN
  RAISE EXCEPTION 'Team % not found. Update v_team_id at the top of this script.', v_team_id;
END IF;

-- ── 1. Demo repo ─────────────────────────────────────────────
INSERT INTO repos (team_id, github_repo_id, owner, name, default_branch, is_active)
VALUES (v_team_id, v_base, 'grassion-demo', 'acme-platform', 'main', true)
ON CONFLICT (github_repo_id) DO UPDATE SET owner = EXCLUDED.owner
RETURNING id INTO v_repo_id;

IF v_repo_id IS NULL THEN
  SELECT id INTO v_repo_id FROM repos WHERE owner = 'grassion-demo' AND team_id = v_team_id LIMIT 1;
END IF;

-- ── 2. Pull requests (24 PRs over 8 weeks) ───────────────────
INSERT INTO pull_requests (team_id, repo_id, github_pr_id, github_pr_number, title, state, author_login,
  opened_at, merged_at, additions, deletions, changed_files, commit_count,
  ai_source, ai_detection_method, ai_confidence, review_count, changes_requested_count,
  was_reverted, triggered_hotfix)
VALUES
  -- W8 (7 weeks ago)
  (v_team_id, v_repo_id, v_base+1,  1,  'Add user authentication middleware',        'merged', 'alex-dev',       w7+INTERVAL '1 day', w7+INTERVAL '2 days', 92,  24, 3, 2, NULL,      NULL,      0,    1, 0, false, false),
  (v_team_id, v_repo_id, v_base+2,  2,  'Implement login flow with Copilot assist',  'merged', 'sarah-eng',      w7+INTERVAL '2 day', w7+INTERVAL '3 days', 104, 28, 4, 2, 'Copilot', 'label',   0.92, 2, 0, false, false),
  -- W7 (6 weeks ago)
  (v_team_id, v_repo_id, v_base+3,  3,  'Fix database connection pooling',           'merged', 'mike-backend',   w6+INTERVAL '1 day', w6+INTERVAL '2 days', 56,  12, 2, 1, NULL,      NULL,      0,    1, 0, false, false),
  (v_team_id, v_repo_id, v_base+4,  4,  'Dashboard layout - built with Copilot',     'merged', 'priya-frontend', w6+INTERVAL '3 day', w6+INTERVAL '4 days', 116, 32, 5, 3, 'Copilot', 'trailer', 0.92, 1, 0, false, false),
  -- W6 (5 weeks ago)
  (v_team_id, v_repo_id, v_base+5,  5,  'User profile page (Copilot)',               'merged', 'alex-dev',       w5+INTERVAL '0 day', w5+INTERVAL '1 days', 128, 36, 6, 2, 'Copilot', 'label',   0.92, 2, 0, false, false),
  (v_team_id, v_repo_id, v_base+6,  6,  'API endpoint refactor via Cursor',          'merged', 'sarah-eng',      w5+INTERVAL '1 day', w5+INTERVAL '2 days', 140, 40, 7, 3, 'Cursor',  'label',   0.92, 1, 0, false, false),
  (v_team_id, v_repo_id, v_base+7,  7,  'Add missing database indexes',              'merged', 'mike-backend',   w5+INTERVAL '2 day', w5+INTERVAL '3 days', 68,  16, 3, 1, NULL,      NULL,      0,    1, 0, false, false),
  -- W5 (4 weeks ago)
  (v_team_id, v_repo_id, v_base+8,  8,  'Notification system (Copilot)',             'merged', 'priya-frontend', w4+INTERVAL '0 day', w4+INTERVAL '1 days', 152, 44, 8, 2, 'Copilot', 'label',   0.92, 2, 0, false, false),
  (v_team_id, v_repo_id, v_base+9,  9,  'Search feature - Cursor',                  'merged', 'alex-dev',       w4+INTERVAL '1 day', w4+INTERVAL '2 days', 164, 48, 9, 3, 'Cursor',  'trailer', 0.92, 3, 1, false, false),
  (v_team_id, v_repo_id, v_base+10, 10, 'Fix search result ordering edge case',      'merged', 'sarah-eng',      w4+INTERVAL '3 day', w4+INTERVAL '4 days', 44,  8,  2, 1, NULL,      NULL,      0,    1, 0, false, false),
  -- W4 (3 weeks ago) — quality dip, reverted PR
  (v_team_id, v_repo_id, v_base+11, 11, 'Payment webhook handler (Copilot)',         'merged', 'mike-backend',   w3+INTERVAL '0 day', w3+INTERVAL '1 days', 176, 52, 10, 2, 'Copilot', 'label',  0.92, 1, 0, false, false),
  (v_team_id, v_repo_id, v_base+12, 12, 'Checkout flow - Cursor',                   'merged', 'priya-frontend', w3+INTERVAL '1 day', w3+INTERVAL '2 days', 188, 56, 11, 3, 'Cursor',  'label',   0.92, 2, 0, false, false),
  (v_team_id, v_repo_id, v_base+13, 13, 'Complex data pipeline - Claude',            'merged', 'alex-dev',       w3+INTERVAL '2 day', w3+INTERVAL '3 days', 200, 60, 12, 2, 'Claude',  'trailer', 0.92, 2, 0, true,  false),
  (v_team_id, v_repo_id, v_base+14, 14, 'Code quality and linting fixes',            'merged', 'sarah-eng',      w3+INTERVAL '3 day', w3+INTERVAL '4 days', 80,  20, 4, 1, NULL,      NULL,      0,    1, 0, false, false),
  -- W3 (2 weeks ago) — hotfix
  (v_team_id, v_repo_id, v_base+15, 15, 'Analytics dashboard (Copilot)',             'merged', 'priya-frontend', w2+INTERVAL '0 day', w2+INTERVAL '1 days', 212, 64, 13, 3, 'Copilot', 'label',   0.92, 1, 0, false, false),
  (v_team_id, v_repo_id, v_base+16, 16, 'ML pipeline integration - Claude',          'merged', 'alex-dev',       w2+INTERVAL '1 day', w2+INTERVAL '2 days', 224, 68, 14, 2, 'Claude',  'label',   0.92, 2, 0, false, false),
  (v_team_id, v_repo_id, v_base+17, 17, 'Real-time feed - Cursor',                  'merged', 'sarah-eng',      w2+INTERVAL '2 day', w2+INTERVAL '3 days', 236, 72, 15, 3, 'Cursor',  'trailer', 0.92, 3, 0, false, true),
  (v_team_id, v_repo_id, v_base+18, 18, 'Fix connection timeout under load',         'merged', 'mike-backend',   w2+INTERVAL '3 day', w2+INTERVAL '4 days', 92,  24, 5, 2, NULL,      NULL,      0,    1, 0, false, false),
  -- W2 (1 week ago) — recovery
  (v_team_id, v_repo_id, v_base+19, 19, 'Reporting module (Copilot)',                'merged', 'alex-dev',       w1+INTERVAL '0 day', w1+INTERVAL '1 days', 248, 76, 16, 2, 'Copilot', 'label',   0.92, 1, 0, false, false),
  (v_team_id, v_repo_id, v_base+20, 20, 'Export feature - Cursor',                  'merged', 'sarah-eng',      w1+INTERVAL '1 day', w1+INTERVAL '2 days', 260, 80, 17, 3, 'Cursor',  'label',   0.92, 2, 0, false, false),
  (v_team_id, v_repo_id, v_base+21, 21, 'Onboarding flow - Claude',                 'merged', 'priya-frontend', w1+INTERVAL '2 day', w1+INTERVAL '3 days', 272, 84, 18, 2, 'Claude',  'trailer', 0.92, 1, 0, false, false),
  (v_team_id, v_repo_id, v_base+22, 22, 'Infrastructure cost optimisations',         'merged', 'mike-backend',   w1+INTERVAL '3 day', w1+INTERVAL '4 days', 104, 28, 6, 1, NULL,      NULL,      0,    1, 0, false, false),
  -- W1 (current week)
  (v_team_id, v_repo_id, v_base+23, 23, 'Performance improvements (Copilot)',        'merged', 'alex-dev',       w0+INTERVAL '0 day', w0+INTERVAL '1 days', 284, 88, 19, 2, 'Copilot', 'label',   0.92, 1, 0, false, false),
  (v_team_id, v_repo_id, v_base+24, 24, 'New dashboard view - Cursor',              'merged', 'sarah-eng',      w0+INTERVAL '1 day', w0+INTERVAL '2 days', 296, 92, 20, 3, 'Cursor',  'label',   0.92, 2, 0, false, false)
ON CONFLICT (github_pr_id) DO NOTHING;

-- ── 3. pr_outcomes (for PRs older than 7 days) ───────────────
INSERT INTO pr_outcomes (pr_id, team_id, was_reverted, reverted_at, ci_failure_count,
  downstream_fix_count, had_hotfix_within_7d, rework_score, computed_at)
SELECT pr.id, v_team_id,
  pr.was_reverted,
  CASE WHEN pr.was_reverted THEN pr.merged_at + INTERVAL '2 days' END,
  CASE WHEN pr.was_reverted THEN 2 ELSE 0 END,
  CASE WHEN pr.changes_requested_count >= 1 AND pr.ai_source IS NOT NULL THEN 1 ELSE 0 END,
  pr.triggered_hotfix,
  CASE
    WHEN pr.was_reverted     THEN 85
    WHEN pr.triggered_hotfix THEN 55
    WHEN pr.changes_requested_count >= 3 THEN 40
    WHEN pr.ai_source IS NOT NULL THEN 8
    ELSE 5
  END,
  NOW()
FROM pull_requests pr
WHERE pr.team_id   = v_team_id
  AND pr.merged_at < NOW() - INTERVAL '7 days'
  AND pr.repo_id   = v_repo_id
ON CONFLICT (pr_id) DO NOTHING;

-- ── 4. weekly_snapshots (8 weeks) ────────────────────────────
INSERT INTO weekly_snapshots (team_id, week_start, total_seats, active_seats, inactive_seats,
  ai_prs, total_prs, ai_adoption_pct, monthly_waste_usd, net_roi_usd, verdict)
VALUES
  (v_team_id, w7, 4, 4, 0, 1, 2, 0.50, 0,   56,  'net_positive'),
  (v_team_id, w6, 4, 4, 0, 1, 2, 0.50, 0,   56,  'net_positive'),
  (v_team_id, w5, 4, 4, 0, 2, 3, 0.67, 0,  131,  'net_positive'),
  (v_team_id, w4, 4, 4, 0, 2, 3, 0.67, 0,  131,  'net_positive'),
  (v_team_id, w3, 4, 2, 2, 3, 4, 0.75, 152, -41, 'net_negative'),
  (v_team_id, w2, 4, 2, 2, 3, 4, 0.75, 152,  18, 'unclear'),
  (v_team_id, w1, 4, 3, 1, 3, 4, 0.75, 76,  206, 'net_positive'),
  (v_team_id, w0, 4, 4, 0, 2, 3, 0.67, 0,  131,  'net_positive')
ON CONFLICT (team_id, week_start) DO UPDATE
  SET ai_prs = EXCLUDED.ai_prs, total_prs = EXCLUDED.total_prs,
      ai_adoption_pct = EXCLUDED.ai_adoption_pct, net_roi_usd = EXCLUDED.net_roi_usd,
      monthly_waste_usd = EXCLUDED.monthly_waste_usd, verdict = EXCLUDED.verdict;

-- ── 5. team_weekly_metrics (cache) ───────────────────────────
INSERT INTO team_weekly_metrics (team_id, week_start, total_prs, ai_prs, human_prs,
  ai_avg_merge_hours, human_avg_merge_hours, ai_rework_rate, human_rework_rate,
  estimated_hours_saved, estimated_hours_lost, estimated_dollar_saved, estimated_dollar_lost, verdict)
VALUES
  (v_team_id, w7, 2, 1, 1, 6, 10, 0,    0, 1.2, 0,   90,  0,   'net_positive'),
  (v_team_id, w6, 2, 1, 1, 6, 10, 0,    0, 1.2, 0,   90,  0,   'net_positive'),
  (v_team_id, w5, 3, 2, 1, 6, 10, 0,    0, 2.4, 0,   180, 0,   'net_positive'),
  (v_team_id, w4, 3, 2, 1, 6, 10, 0,    0, 2.4, 0,   180, 0,   'net_positive'),
  (v_team_id, w3, 4, 3, 1, 6, 10, 0.33, 0, 3.6, 3,   270, 225, 'net_negative'),
  (v_team_id, w2, 4, 3, 1, 6, 10, 0,    0, 3.6, 0,   270, 0,   'unclear'),
  (v_team_id, w1, 4, 3, 1, 6, 10, 0,    0, 3.6, 0,   270, 0,   'net_positive'),
  (v_team_id, w0, 3, 2, 1, 6, 10, 0,    0, 2.4, 0,   180, 0,   'net_positive')
ON CONFLICT (team_id, week_start) DO NOTHING;

-- ── 6. developer_weekly_metrics (4 devs × 8 weeks) ───────────
INSERT INTO developer_weekly_metrics (team_id, github_login, week_start, total_prs, ai_prs,
  reverted_prs, hotfix_prs, avg_review_cycles, avg_pr_size, ai_confidence_avg, quality_score,
  is_active, primary_ai_tool)
VALUES
  (v_team_id, 'alex-dev',       w7::date, 1, 0, 0, 0, 1.2, 120, 0,    70, true,  NULL),
  (v_team_id, 'sarah-eng',      w7::date, 1, 1, 0, 0, 1.2, 120, 0.92, 80, true,  'Copilot'),
  (v_team_id, 'mike-backend',   w7::date, 0, 0, 0, 0, 0,   0,   0,    0,  false, NULL),
  (v_team_id, 'priya-frontend', w7::date, 0, 0, 0, 0, 0,   0,   0,    0,  false, NULL),

  (v_team_id, 'alex-dev',       w6::date, 0, 0, 0, 0, 0,   0,   0,    0,  false, NULL),
  (v_team_id, 'sarah-eng',      w6::date, 0, 0, 0, 0, 0,   0,   0,    0,  false, NULL),
  (v_team_id, 'mike-backend',   w6::date, 1, 0, 0, 0, 1.2, 120, 0,    68, true,  NULL),
  (v_team_id, 'priya-frontend', w6::date, 1, 1, 0, 0, 1.2, 120, 0.92, 78, true,  'Copilot'),

  (v_team_id, 'alex-dev',       w5::date, 1, 1, 0, 0, 1.2, 120, 0.92, 82, true,  'Copilot'),
  (v_team_id, 'sarah-eng',      w5::date, 1, 1, 0, 0, 1.2, 120, 0.92, 79, true,  'Cursor'),
  (v_team_id, 'mike-backend',   w5::date, 1, 0, 0, 0, 1.2, 120, 0,    65, true,  NULL),
  (v_team_id, 'priya-frontend', w5::date, 0, 0, 0, 0, 0,   0,   0,    0,  false, NULL),

  (v_team_id, 'alex-dev',       w4::date, 1, 1, 0, 0, 1.2, 120, 0.92, 81, true,  'Cursor'),
  (v_team_id, 'sarah-eng',      w4::date, 1, 0, 0, 0, 1.2, 120, 0,    66, true,  NULL),
  (v_team_id, 'mike-backend',   w4::date, 0, 0, 0, 0, 0,   0,   0,    0,  false, NULL),
  (v_team_id, 'priya-frontend', w4::date, 1, 1, 0, 0, 1.2, 120, 0.92, 80, true,  'Copilot'),

  (v_team_id, 'alex-dev',       w3::date, 1, 1, 1, 0, 1.2, 120, 0.92, 30, true,  'Claude'),
  (v_team_id, 'sarah-eng',      w3::date, 1, 0, 0, 0, 1.2, 120, 0,    62, true,  NULL),
  (v_team_id, 'mike-backend',   w3::date, 1, 1, 0, 0, 1.2, 120, 0.92, 76, true,  'Copilot'),
  (v_team_id, 'priya-frontend', w3::date, 1, 1, 0, 0, 1.2, 120, 0.92, 74, true,  'Cursor'),

  (v_team_id, 'alex-dev',       w2::date, 1, 1, 0, 0, 1.2, 120, 0.92, 78, true,  'Claude'),
  (v_team_id, 'sarah-eng',      w2::date, 1, 1, 0, 1, 1.2, 120, 0.92, 45, true,  'Cursor'),
  (v_team_id, 'mike-backend',   w2::date, 1, 0, 0, 0, 1.2, 120, 0,    60, false, NULL),
  (v_team_id, 'priya-frontend', w2::date, 1, 1, 0, 0, 1.2, 120, 0.92, 77, true,  'Copilot'),

  (v_team_id, 'alex-dev',       w1::date, 1, 1, 0, 0, 1.2, 120, 0.92, 85, true,  'Copilot'),
  (v_team_id, 'sarah-eng',      w1::date, 1, 1, 0, 0, 1.2, 120, 0.92, 83, true,  'Cursor'),
  (v_team_id, 'mike-backend',   w1::date, 1, 0, 0, 0, 1.2, 120, 0,    69, false, NULL),
  (v_team_id, 'priya-frontend', w1::date, 1, 1, 0, 0, 1.2, 120, 0.92, 82, true,  'Claude'),

  (v_team_id, 'alex-dev',       w0::date, 1, 1, 0, 0, 1.2, 120, 0.92, 88, true,  'Copilot'),
  (v_team_id, 'sarah-eng',      w0::date, 1, 1, 0, 0, 1.2, 120, 0.92, 86, true,  'Cursor'),
  (v_team_id, 'mike-backend',   w0::date, 0, 0, 0, 0, 0,   0,   0,    0,  false, NULL),
  (v_team_id, 'priya-frontend', w0::date, 1, 0, 0, 0, 1.2, 120, 0,    71, true,  NULL)
ON CONFLICT (team_id, github_login, week_start) DO NOTHING;

-- ── 7. tool_weekly_metrics ────────────────────────────────────
INSERT INTO tool_weekly_metrics (team_id, tool_name, week_start, pr_count, revert_count,
  hotfix_count, avg_changes_requested, quality_score, estimated_spend_usd, active_users)
VALUES
  (v_team_id, 'Copilot', w7::date, 1, 0, 0, 1.0, 80, 10, 1),
  (v_team_id, 'Copilot', w6::date, 1, 0, 0, 1.0, 78, 10, 1),
  (v_team_id, 'Copilot', w5::date, 1, 0, 0, 1.0, 82, 10, 1),
  (v_team_id, 'Cursor',  w5::date, 1, 0, 0, 1.1, 79, 20, 1),
  (v_team_id, 'Copilot', w4::date, 1, 0, 0, 1.0, 80, 10, 1),
  (v_team_id, 'Cursor',  w4::date, 1, 0, 0, 1.1, 81, 20, 1),
  (v_team_id, 'Copilot', w3::date, 1, 0, 0, 1.0, 76, 10, 1),
  (v_team_id, 'Cursor',  w3::date, 1, 0, 0, 1.1, 74, 20, 1),
  (v_team_id, 'Copilot', w2::date, 1, 0, 0, 1.0, 77, 10, 1),
  (v_team_id, 'Cursor',  w2::date, 1, 1, 1, 1.1, 45, 20, 1),
  (v_team_id, 'Copilot', w1::date, 1, 0, 0, 1.0, 85, 10, 1),
  (v_team_id, 'Cursor',  w1::date, 1, 0, 0, 1.1, 83, 20, 1),
  (v_team_id, 'Copilot', w0::date, 1, 0, 0, 1.0, 88, 10, 1),
  (v_team_id, 'Cursor',  w0::date, 1, 0, 0, 1.1, 86, 20, 1)
ON CONFLICT (team_id, tool_name, week_start) DO NOTHING;

-- ── 8. codebase_health_snapshots ─────────────────────────────
INSERT INTO codebase_health_snapshots (team_id, snapshot_date, overall_health_score,
  ai_adoption_pct, revert_rate_pct, hotfix_rate_pct, avg_pr_quality,
  active_developers, total_developers, risk_level)
VALUES
  (v_team_id, w7::date, 72, 50,  0,  0,  72, 4, 4, 'low'),
  (v_team_id, w6::date, 73, 50,  0,  0,  73, 4, 4, 'low'),
  (v_team_id, w5::date, 76, 67,  0,  0,  76, 4, 4, 'low'),
  (v_team_id, w4::date, 78, 67,  0,  0,  78, 4, 4, 'low'),
  (v_team_id, w3::date, 51, 75, 33,  0,  51, 2, 4, 'high'),
  (v_team_id, w2::date, 59, 75,  0, 33,  59, 2, 4, 'medium'),
  (v_team_id, w1::date, 82, 75,  0,  0,  82, 3, 4, 'low'),
  (v_team_id, w0::date, 84, 67,  0,  0,  84, 4, 4, 'low')
ON CONFLICT (team_id, snapshot_date) DO UPDATE
  SET overall_health_score = EXCLUDED.overall_health_score,
      ai_adoption_pct = EXCLUDED.ai_adoption_pct,
      revert_rate_pct = EXCLUDED.revert_rate_pct;

-- ── 9. savings_events ────────────────────────────────────────
INSERT INTO savings_events (team_id, inactive_count, monthly_waste_usd, detected_at)
VALUES
  (v_team_id, 2, 152, w3 + INTERVAL '2 days'),
  (v_team_id, 1, 76,  w1 + INTERVAL '2 days')
ON CONFLICT DO NOTHING;

-- ── 10. team_milestones ──────────────────────────────────────
INSERT INTO team_milestones (team_id, milestone, achieved_at)
VALUES
  (v_team_id, 'first_ai_pr',    w7 + INTERVAL '3 days'),
  (v_team_id, 'adoption_50pct', w3 + INTERVAL '1 day'),
  (v_team_id, 'roi_positive',   w7 + INTERVAL '3 days')
ON CONFLICT (team_id, milestone) DO NOTHING;

-- ── 11. Mark demo mode active ────────────────────────────────
UPDATE teams SET demo_mode = true, updated_at = NOW() WHERE id = v_team_id;

RAISE NOTICE 'Seed complete for team %', v_team_id;
END $$;
