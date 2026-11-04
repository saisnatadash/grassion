# Admin Discovery — Grassion

Step 1 of the private admin panel build. No code changes in this document.

---

## 1. Database Tables (39 total)

### Core accounts

| Table | What it holds |
|-------|---------------|
| `teams` | One row per customer account. Plan tier, Razorpay subscription/customer IDs, GitHub App installation ID, avg dev hourly rate, digest day/hour preference, HC-enabled flag, privacy settings (store_pr_body, etc.). |
| `users` | GitHub-authed users. github_login, name, avatar, role (`owner`/`member`), is_seat_active, last_active_at, ai_tool. FK → teams. |
| `sessions` | Active JWT sessions. user_id, expires_at, created_at. |
| `referral_codes` | Referral program. code slug, owner github_login, commission %, is_active. |
| `referral_conversions` | One row per team-per-code conversion. plan_at_conversion, mrr_usd, commission_usd. |

### Repositories & pull requests

| Table | What it holds |
|-------|---------------|
| `repos` | Installed repositories. Full name, private flag, default branch, tracking start date, is_archived. FK → teams. |
| `pull_requests` | Every merged/closed PR from installed repos. Author login/id, title, state, additions, deletions, changed_files, commit_count, review_count, changes_requested_count, ai_source, ai_detection_method, ai_confidence, was_reverted, triggered_hotfix, raw_metadata (JSON — labels, reviews, check_runs; patch fields are never stored). |

### Outcome computation

| Table | What it holds |
|-------|---------------|
| `pr_outcomes` | One row per PR. rework_score (0–100), was_reverted, reverted_at, ci_failure_count, downstream_fix_count, had_hotfix_within_7d, hotfix_signals (JSON array), ai_summary (OpenAI-generated for problem PRs only), ai_summary_generated_at, computed_at. |
| `pr_outcome_timeline` | Checkpoint rows at 7, 14, and 30 days after merge. dollar_impact per checkpoint. |
| `outcome_check_queue` | Worker job queue. prId, checkpoint_days (7/14/30), run_after, completed_at, attempts, last_error. |
| `pr_risk_signals` | Per-PR fine-grained risk signals. signal_type, signal_value, confidence, description. |

### Metrics & snapshots

| Table | What it holds |
|-------|---------------|
| `team_weekly_metrics` | Weekly aggregate per team. ai_prs, total_prs, ai_adoption_pct, net_roi_usd, monthly_waste_usd, verdict. |
| `weekly_snapshots` | Permanent copy of each calendar week — never deleted or overwritten. Same columns as team_weekly_metrics plus total/active/inactive seat counts. |
| `developer_history` | Per-developer, per-week AI usage. ai_pr_count, total_pr_count, is_active. Permanent. |
| `developer_weekly_metrics` | Richer per-developer weekly row. quality_score, ai_confidence_avg, avg_review_cycles, primary_ai_tool, is_active. |
| `tool_weekly_metrics` | Per-AI-tool weekly stats. pr_count, revert_count, hotfix_count, avg_changes_requested, quality_score, estimated_spend_usd, active_users. |
| `codebase_health_snapshots` | Overall health score per team per date. overall_health_score, ai_adoption_pct, revert_rate_pct, hotfix_rate_pct, avg_pr_quality, risk_level (low/medium/high). |
| `savings_events` | Triggered ~every 6h when inactive seats are detected. inactive_count, monthly_waste_usd. Powers the "Savings Unlocked" card. |
| `team_milestones` | Achievement milestones, one row per milestone per team. Never deleted. |

### Notifications & digests

| Table | What it holds |
|-------|---------------|
| `notifications` | In-app alerts. type (`revert_detected`\|`problem_pr`\|`hotfix_surge`), title, body, link, source_id (the PR that triggered it), read_at. |
| `email_digests` | Digest send log. team_id, week_start, sent_at, type. |

### Benchmarks

| Table | What it holds |
|-------|---------------|
| `industry_benchmarks` | Anonymized cross-team benchmark data for the industry comparison card. |
| `team_benchmark_contributions` | Tracks which teams have contributed data points to the benchmark pool. |

### LLM usage

| Table | What it holds |
|-------|---------------|
| `llm_usage_log` | Every OpenAI API call made by the system. model, input_tokens, output_tokens, est_cost_usd, team_id, purpose (e.g. `pr_summary`), created_at. Used for per-team daily cap and global monthly cap enforcement. |

### RFG analysis (Rework-From-GitHub)

| Table | What it holds |
|-------|---------------|
| `rfg_analysis_runs` | Background job runs that classify historical PRs. status (pending/running/complete/failed), cursor, prs_fetched, since_date. |
| `rfg_pr_labels` | Classification result per PR. label (`reverted`\|`hotfix`\|null), label_reason, revert/hotfix PR number. |
| `rfg_pr_file_paths` | File-level records per labeled PR. filename, additions, deletions only — no patch content. |

### Human Coverage (HC)

| Table | What it holds |
|-------|---------------|
| `hc_people` | Team member registry for HC. github_login, github_id, is_active, left_at. |
| `hc_code_areas` | Repo directory paths at top-2 levels (e.g. `src/services`). is_critical, last_changed_at. |
| `hc_evidence_events` | Evidence of human understanding. type (incident_fix\|successful_edit\|substantive_review\|answered_question\|understanding_click\|explain_back\|large_ai_change_unreviewed), weight, source_url, pr_number. |
| `hc_failures` | Detected coverage failures. state (candidate\|confirmed\|obsolete), area_ids, original/revert/fix PR numbers. |
| `hc_coverage_snapshots` | Computed coverage scores per area. coverage_count, people (JSON: login+weight pairs), dark (boolean), fragile (boolean). |
| `hc_understanding_answers` | Developer self-reported understanding after a PR. answer (`understand`\|`partly`\|`ai_wrote_it`), pr_number. |
| `hc_backfill_runs` | Backfill job state. status, since_date, last_processed_page, prs_fetched, evidence_created. |
| `hc_share_tokens` | Shareable read-only HC report links. token, expires_at (14 days), created_by, repo_id. |

### Audit & webhooks

| Table | What it holds |
|-------|---------------|
| `audit_logs` | Admin-visible action log. actor, action, target_type, target_id, metadata (JSON), ip, created_at. |
| `webhook_events` | GitHub webhook delivery ID log for idempotency. One row per X-Github-Delivery. processed flag. |

### Contact

| Table | What it holds |
|-------|---------------|
| `contact_submissions` | Marketing contact form submissions. name, email, topic, message, created_at. |

### Engineering events

| Table | What it holds |
|-------|---------------|
| `engineering_events` | Generic engineering event log. event_type, github_login, metadata (JSON), occurred_at. |

---

## 2. Forms

### Marketing site (`grassion.com`)

| Form | URL | Fields | Where submission goes |
|------|-----|--------|-----------------------|
| **Contact** | `/contact/` | name, email, topic (Sales/Support/Collaborate/Bug report/Other), message, _website_ (honeypot — hidden) | `POST https://grassion-api.fly.dev/api/contact` → stored in `contact_submissions` table + forwarded via Zoho SMTP to info@grassion.com |

No other forms exist on the marketing site. There is no careers page, waitlist, demo request, or sign-up flow on the marketing site — the only CTAs are "Start for free" links that go to `app.grassion.com`.

### App (`app.grassion.com`)

| Form / action | Location | Fields | Where it goes |
|---------------|----------|--------|---------------|
| **GitHub login** | `/login` | (OAuth redirect — no input fields) | GitHub OAuth → creates session in `sessions`, upserts `users`/`teams` |
| **Onboarding — select repos** | `/onboarding` | repo checkboxes | `POST /api/repos` → inserts into `repos` |
| **Team name & digest settings** | Settings → Team | team_name, digest_day, digest_hour, avg_dev_hourly_rate_usd | `PATCH /api/settings/team` → updates `teams` |
| **AI tool costs** | Settings → AI tool costs | per-tool monthly cost USD | `PATCH /api/settings/ai-costs` → updates `teams.ai_tool_costs` |
| **Slack webhook** | Settings → Slack | slack_webhook_url | `PATCH /api/settings/slack` → updates `teams` |
| **Human Coverage toggle** | Settings → HC | hc_enabled (boolean) | `PATCH /api/settings/hc` → updates `teams` |
| **Privacy controls** | Settings → Privacy | store_pr_body, store_pr_description, store_commit_messages | `PATCH /api/settings/privacy` → updates `teams` |
| **MCP token create** | Settings → MCP | token name | `POST /api/settings/mcp-tokens` → creates token |
| **MCP token revoke** | Settings → MCP | token ID | `DELETE /api/settings/mcp-tokens/:id` |
| **Plan upgrade** | Billing page | (Razorpay widget — no HTML fields) | `POST /api/billing/create-order` → Razorpay → webhook updates `teams.plan` |
| **HC understanding answer** | In-app HC prompt (per PR) | answer (understand\|partly\|ai_wrote_it) | Stored in `hc_understanding_answers` |
| **HC share link create** | HC report page | (button — no input) | `POST /api/hc/share` → creates row in `hc_share_tokens` (14-day expiry) |

---

## 3. Chatbots and Bots

**No chatbot** exists on the marketing site or the app.

The Grassion **GitHub App** is a webhook listener only. It ingests push/PR/review events and writes to the database — it does not post comments on PRs, open issues, or initiate any GitHub action. No bot-generated comments or conversations are stored.

---

## 4. Analytics and Tracking

### Third-party tracking — **none currently deployed**

No Google Analytics, Mixpanel, Segment, Plausible, Fathom, Hotjar, or Microsoft Clarity tags appear in any marketing page HTML or app bundle. The privacy policy text mentions "Sentry/Plausible" as *potential* tools, but neither script is actually loaded today.

### First-party (internal) analytics — stored in the database

All product metrics are computed from raw GitHub data and stored in-database. The `/api/analytics/*` routes read these tables to power the customer dashboard:

| Route | Table(s) read |
|-------|---------------|
| `/api/analytics/seat-waste` | `users`, `pull_requests` |
| `/api/analytics/savings-history` | `savings_events` |
| `/api/analytics/journey` | `team_weekly_metrics` |
| `/api/analytics/outcomes` | `pr_outcomes`, `pull_requests` |
| `/api/analytics/health` | `codebase_health_snapshots`, `pr_outcomes` |
| `/api/analytics/pr-outcomes` | `pr_outcomes`, `pull_requests` (Pro plan only) |
| `/api/analytics/pr-decay/:prId` | `pr_outcome_timeline` (Pro plan only) |
| `/api/analytics/developer-metrics` | `developer_weekly_metrics` |
| `/api/analytics/tool-comparison` | `tool_weekly_metrics` |
| `/api/analytics/codebase-health` | `codebase_health_snapshots` |

There is no visitor-behavior tracking (page views, clicks, session recordings) anywhere in the product today.

---

## Summary gaps / things to decide before building the admin panel

1. **Admin authentication** — the `teams.plan = 'admin'` tier exists in the codebase but no admin login flow is wired yet. Options: single hardcoded email gate, separate admin JWT secret, or IP allowlist.
2. **`contact_submissions` read access** — these are stored but there is no UI or API route to read them back. The admin panel will need a route for this.
3. **No visitor analytics** — the admin panel cannot show "how many people visited the marketing site" because that data is not collected anywhere.
4. **`audit_logs` visibility** — the table exists but there is no route that exposes its contents. Admin panel should expose this.
5. **LLM cost visibility** — `llm_usage_log` has team-level and global cost data but no route aggregates it for a founder view.
