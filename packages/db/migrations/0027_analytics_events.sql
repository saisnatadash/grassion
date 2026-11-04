-- First-party analytics events (no IP stored; bot-filtered at ingest).
CREATE TABLE IF NOT EXISTS analytics_events (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id  text        NOT NULL,
  event_name  text        NOT NULL,
  source      text        NOT NULL,  -- 'marketing' | 'app'
  page        text        NOT NULL,
  referrer    text,
  team_id     uuid        REFERENCES teams(id) ON DELETE SET NULL,
  metadata    jsonb       DEFAULT '{}',
  occurred_at timestamp   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS analytics_events_source_occurred_idx
  ON analytics_events(source, occurred_at DESC);
CREATE INDEX IF NOT EXISTS analytics_events_session_idx
  ON analytics_events(session_id);
CREATE INDEX IF NOT EXISTS analytics_events_page_idx
  ON analytics_events(source, page, occurred_at DESC);
CREATE INDEX IF NOT EXISTS analytics_events_name_idx
  ON analytics_events(event_name, occurred_at DESC);
