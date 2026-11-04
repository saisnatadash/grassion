import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'

const __dir = path.dirname(fileURLToPath(import.meta.url))
const migrationsDir = path.resolve(__dir, '../migrations')

async function main() {
  const databaseUrl = process.env['DATABASE_URL']
  if (!databaseUrl) {
    console.error('[db:status] DATABASE_URL is required')
    process.exit(1)
  }

  const migrationFiles = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql') && /^\d{4}/.test(f))
    .sort()

  const sql = postgres(databaseUrl, { max: 1, ssl: 'require' })

  let appliedCount = 0
  try {
    let rows: Array<{ hash: string }> = []
    try {
      rows = (await sql`SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at`) as Array<{ hash: string }>
    } catch {
      rows = (await sql`SELECT hash FROM __drizzle_migrations ORDER BY created_at`) as Array<{ hash: string }>
    }
    appliedCount = rows.length
  } catch {
    console.warn('[db:status] Could not read drizzle migrations table — assuming 0 applied.')
  }

  const totalFiles = migrationFiles.length
  const pendingCount = Math.max(0, totalFiles - appliedCount)

  console.log('\n── Grassion DB migration status ─────────────────────────────')
  console.log(`   Migration files:   ${totalFiles}`)
  console.log(`   Applied:           ${appliedCount}`)
  console.log(`   Possibly pending:  ${pendingCount}`)
  console.log('\n   Files (oldest → newest):')
  migrationFiles.forEach((f, i) => {
    const marker = i < appliedCount ? '  ✓' : '  ✗ PENDING'
    console.log(`${marker}  ${f}`)
  })

  if (pendingCount > 0) {
    console.log('\n── To apply pending migrations ──────────────────────────────')
    console.log('   Via Drizzle (recommended):')
    console.log('     pnpm db:migrate\n')
    console.log('   Via Supabase SQL editor or psql (run each pending file):')
    for (let i = appliedCount; i < totalFiles; i++) {
      const file = migrationFiles[i]!
      console.log(`     psql "$DATABASE_URL" -f packages/db/migrations/${file}`)
    }
    console.log()
  } else {
    console.log('\n   All migrations applied. ✓\n')
  }

  await sql.end()
}

main().catch((err) => {
  console.error('[db:status]', err)
  process.exit(1)
})
