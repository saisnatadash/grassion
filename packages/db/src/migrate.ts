import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

async function main() {
  const rawUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL
  if (!rawUrl) {
    console.error('DATABASE_URL is not set')
    process.exit(1)
  }

  let u: URL
  try {
    u = new URL(rawUrl)
  } catch {
    console.error('DATABASE_URL is not a valid URL:', rawUrl)
    process.exit(1)
  }

  // DB_PASSWORD lets the raw password be set without URL encoding (e.g. passwords with @)
  const password = process.env.DB_PASSWORD ?? decodeURIComponent(u.password)

  console.log(`Connecting to ${u.hostname}:${u.port || 5432} as ${decodeURIComponent(u.username)}`)

  const client = postgres({
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
