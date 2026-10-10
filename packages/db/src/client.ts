import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema.js'

let _client: postgres.Sql | undefined
let _db: ReturnType<typeof drizzle<typeof schema>> | undefined

function buildOptions(overrides: Partial<postgres.Options<Record<string, never>>> = {}): postgres.Options<Record<string, never>> {
  const rawUrl = process.env.DATABASE_URL
  if (!rawUrl) throw new Error('DATABASE_URL is not set')

  let u: URL
  try {
    u = new URL(rawUrl)
  } catch {
    throw new Error(`DATABASE_URL is not a valid URL: ${rawUrl}`)
  }

  // DB_PASSWORD lets the raw password be set without URL encoding (e.g. passwords with @)
  const password = process.env.DB_PASSWORD ?? decodeURIComponent(u.password)

  return {
    host: u.hostname,
    port: u.port ? parseInt(u.port) : 5432,
    database: u.pathname.slice(1) || 'postgres',
    username: decodeURIComponent(u.username) || 'postgres',
    password,
    ssl: { rejectUnauthorized: false },
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    idle_timeout: 20,
    connect_timeout: 30,
    prepare: false,
    ...overrides,
  }
}

export function getClient(): postgres.Sql {
  if (!_client) {
    _client = postgres(buildOptions())
  }
  return _client
}

export function getDb() {
  if (!_db) {
    _db = drizzle(getClient(), { schema, logger: process.env.DRIZZLE_LOG === '1' })
  }
  return _db
}

export type Db = ReturnType<typeof getDb>

export async function closeDb() {
  if (_client) {
    await _client.end({ timeout: 5 })
    _client = undefined
    _db = undefined
  }
}
