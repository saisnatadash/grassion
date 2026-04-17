import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema.js'

let _client: postgres.Sql | undefined
let _db: ReturnType<typeof drizzle<typeof schema>> | undefined

function getConnectionString(): string {
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error('DATABASE_URL is not set')
  }
  return url
}

export function getClient(): postgres.Sql {
  if (!_client) {
    _client = postgres(getConnectionString(), {
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
    })
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
