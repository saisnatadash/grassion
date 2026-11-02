import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '@grassion/db'

const DATABASE_URL = process.env['DATABASE_URL']
if (!DATABASE_URL) throw new Error('DATABASE_URL is required for the Grassion MCP server')

const client = postgres(DATABASE_URL, { ssl: { rejectUnauthorized: false }, max: 2, idle_timeout: 20, prepare: false })
export const db = drizzle(client, { schema })
