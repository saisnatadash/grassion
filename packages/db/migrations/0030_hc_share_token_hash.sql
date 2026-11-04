-- Migrate hc_share_tokens.token (plaintext) to token_hash (SHA-256 hex).
-- Tokens issued before this migration are invalidated (they will not match a
-- hash lookup). This is intentional — a 14-day token window means at most
-- 14 days' worth of share links break; teams can regenerate them.

ALTER TABLE hc_share_tokens ADD COLUMN IF NOT EXISTS token_hash text;

-- Backfill existing rows using Postgres built-in sha256.
UPDATE hc_share_tokens
  SET token_hash = encode(sha256(token::bytea), 'hex')
  WHERE token_hash IS NULL;

ALTER TABLE hc_share_tokens ALTER COLUMN token_hash SET NOT NULL;

-- Replace the old unique index.
DROP INDEX IF EXISTS hc_share_tokens_token_idx;
CREATE UNIQUE INDEX IF NOT EXISTS hc_share_tokens_token_hash_idx ON hc_share_tokens (token_hash);

-- Drop the now-redundant plaintext column.
ALTER TABLE hc_share_tokens DROP COLUMN IF EXISTS token;
