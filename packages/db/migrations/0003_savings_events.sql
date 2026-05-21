CREATE TABLE IF NOT EXISTS "savings_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "team_id" uuid NOT NULL REFERENCES "teams"("id") ON DELETE CASCADE,
  "inactive_count" integer NOT NULL,
  "monthly_waste_usd" real NOT NULL,
  "detected_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "savings_events_team_idx" ON "savings_events" ("team_id");
CREATE INDEX IF NOT EXISTS "savings_events_team_date_idx" ON "savings_events" ("team_id", "detected_at");
