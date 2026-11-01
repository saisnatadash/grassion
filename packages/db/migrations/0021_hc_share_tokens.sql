-- Shareable read-only report links for Human Coverage (expire in 14 days).
CREATE TABLE IF NOT EXISTS "hc_share_tokens" (
  "id"         uuid        PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id"     uuid        NOT NULL REFERENCES "teams"("id") ON DELETE CASCADE,
  "repo_id"    uuid        NOT NULL REFERENCES "repos"("id") ON DELETE CASCADE,
  "token"      text        NOT NULL,
  "expires_at" timestamp   NOT NULL,
  "created_by" text        NOT NULL,
  "created_at" timestamp   NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "hc_share_tokens_token_idx"
  ON "hc_share_tokens" ("token");
CREATE INDEX IF NOT EXISTS "hc_share_tokens_expires_idx"
  ON "hc_share_tokens" ("expires_at");
