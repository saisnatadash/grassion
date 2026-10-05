CREATE TABLE IF NOT EXISTS "audit_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "team_id" uuid REFERENCES "teams"("id") ON DELETE SET NULL,
  "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "action" text NOT NULL,
  "resource_type" text,
  "resource_id" text,
  "ip_address" text,
  "user_agent" text,
  "metadata" jsonb DEFAULT '{}',
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "audit_logs_team_created_idx" ON "audit_logs" ("team_id", "created_at");
CREATE INDEX IF NOT EXISTS "audit_logs_action_created_idx" ON "audit_logs" ("action", "created_at");
