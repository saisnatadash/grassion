/**
 * Runs idempotent ALTER TABLE statements for every column that was added to
 * the `teams` table after the initial schema (migration 0022 and later).
 *
 * This script exists because Drizzle's INSERT query enumerates ALL schema
 * columns explicitly.  If a later migration hasn't been applied yet — e.g.
 * because the Drizzle migrator failed on first boot — the INSERT fails with
 * "column X of relation teams does not exist".
 *
 * Running this before migrate.js guarantees the critical teams columns exist
 * even when the full migration run hasn't succeeded yet.
 */
import postgres from 'postgres'

async function main() {
  const rawUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL
  if (!rawUrl) {
    console.log('ensure-schema: DATABASE_URL not set — skipping')
    return
  }

  let u: URL
  try {
    u = new URL(rawUrl)
  } catch {
    console.log('ensure-schema: DATABASE_URL not a valid URL — skipping')
    return
  }

  const password = process.env.DB_PASSWORD ?? decodeURIComponent(u.password)

  const sql = postgres({
    host: u.hostname,
    port: u.port ? parseInt(u.port) : 5432,
    database: u.pathname.slice(1) || 'postgres',
    username: decodeURIComponent(u.username) || 'postgres',
    password,
    ssl: { rejectUnauthorized: false },
    max: 1,
    prepare: false,
    connect_timeout: 30,
  })

  try {
    // Migration 0022: hc_hooks — HC check-run settings on teams
    await sql`ALTER TABLE teams ADD COLUMN IF NOT EXISTS hc_check_run_enabled  boolean NOT NULL DEFAULT false`
    await sql`ALTER TABLE teams ADD COLUMN IF NOT EXISTS hc_block_on_critical   boolean NOT NULL DEFAULT false`
    await sql`ALTER TABLE teams ADD COLUMN IF NOT EXISTS hc_max_review_requests integer NOT NULL DEFAULT 5`

    // Migration 0023: plan_tiers — privacy controls
    await sql`ALTER TABLE teams ADD COLUMN IF NOT EXISTS team_only_mode           boolean NOT NULL DEFAULT false`
    await sql`ALTER TABLE teams ADD COLUMN IF NOT EXISTS per_dev_metrics_enabled  boolean NOT NULL DEFAULT false`

    // Migration 0024: slack_team_id
    await sql`ALTER TABLE teams ADD COLUMN IF NOT EXISTS slack_team_id text`

    // Migration 0032: team_scheduled_deletion
    await sql`ALTER TABLE teams ADD COLUMN IF NOT EXISTS scheduled_deletion_at timestamptz`

    console.log('ensure-schema: teams columns verified OK')
  } catch (err) {
    // Non-fatal: log and continue — the full migrator handles canonical schema.
    console.error('ensure-schema: warning —', err instanceof Error ? err.message : String(err))
  } finally {
    await sql.end()
  }
}

main().catch((err) => {
  console.error('ensure-schema: unexpected error —', err)
  // Exit 0 intentionally: startup must continue even if this fails.
  process.exit(0)
})
