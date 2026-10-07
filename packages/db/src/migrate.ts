import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('DATABASE_URL is not set')
    process.exit(1)
  }

  // Migrations need a direct Postgres connection — Supabase's pgBouncer pooler
  // (port 6543) does not support advisory locks that Drizzle migrate uses.
  // Set DIRECT_DATABASE_URL to the direct connection string (port 5432) in Fly
  // secrets; fall back to DATABASE_URL if not provided.
  const migrateUrl = process.env.DIRECT_DATABASE_URL ?? url
  const client = postgres(migrateUrl, {
    max: 1,
    prepare: false,
    ssl: { rejectUnauthorized: false },
  })
  const db = drizzle(client)

  const migrationsFolder = join(__dirname, '../migrations')
  console.log('Running migrations from', migrationsFolder)
  await migrate(db, { migrationsFolder })
  console.log('Migrations complete.')

  await client.end()
}

main().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
