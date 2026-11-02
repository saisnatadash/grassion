# Grassion MCP Server

The Grassion MCP server exposes Human Coverage data directly inside your AI coding tool. Ask Claude or Cursor "who owns this file?" and get an immediate answer based on your team's actual merge history.

## Tools

| Tool | Parameters | Returns |
|---|---|---|
| `human_coverage` | `repo`, `path` | Who covers a file/directory, coverage weights, dark flag |
| `dark_areas` | `repo` | All dark areas in a repo, sorted critical-first |

## Setup

### 1. Get an API token

In Grassion: **Settings → MCP Tokens → New token**. Copy the raw token — it is only shown once. The token is scoped to your organisation.

### 2. Install the MCP package

```bash
npx -y @grassion/mcp  # or install globally
```

Or clone this repo and run `pnpm build` in `apps/mcp/`.

### 3. Configure your tool

#### Claude Code (`.claude/mcp.json` or `mcpServers` in settings)

```json
{
  "mcpServers": {
    "grassion": {
      "command": "npx",
      "args": ["-y", "@grassion/mcp"],
      "env": {
        "GRASSION_API_TOKEN": "grs_your_token_here",
        "DATABASE_URL": "postgresql://..."
      }
    }
  }
}
```

#### Cursor (`.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "grassion": {
      "command": "node",
      "args": ["/path/to/apps/mcp/dist/index.js"],
      "env": {
        "GRASSION_API_TOKEN": "grs_your_token_here",
        "DATABASE_URL": "postgresql://..."
      }
    }
  }
}
```

#### Add to CLAUDE.md (recommended)

```markdown
## Team coverage

Before editing any file, check who covers it:
\`\`\`
human_coverage(repo="frontend", path="<the file you're editing>")
\`\`\`
If the area is dark, add a note in your PR and flag it for review.
```

## Example usage

```
You: Who covers src/auth/login.ts?

Claude: ✅ `src/auth` is covered by @alice (3.2), @bob (1.5).
        (This is a critical area — extra care advised.)
```

```
You: Show me all dark areas in the payments service.

Claude: 40% of 25 areas are dark (10 total).

🔴 `src/billing` — last changed 2026-10-15 (CRITICAL)
⚫ `src/subscriptions` — last changed 2026-09-30
⚫ `src/invoices` — last changed 2026-08-12
…
```

## Privacy

The MCP server only reads computed coverage data from Grassion's database. It never accesses your source code, diff patches, or repository contents directly. Coverage data is derived from PR metadata (merge history, reviewers, labels) following the same privacy rules as the rest of Grassion.
