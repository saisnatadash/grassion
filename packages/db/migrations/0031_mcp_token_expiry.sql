-- Add optional expiry to MCP API tokens.
-- NULL means the token never expires (default for existing tokens).
ALTER TABLE mcp_api_tokens ADD COLUMN IF NOT EXISTS expires_at timestamptz;
