// Vitest stub for @grassion/db — exports schema tables + a no-op getDb so
// db.ts can be imported without attempting a Postgres connection.
export * from '../../../../packages/db/src/schema.js'

export function getDb() {
  // Real DB calls are mocked per-test via vi.mock('../db.js', …).
  // This stub prevents Postgres connection on module initialization.
  return {} as ReturnType<typeof import('../../../../packages/db/src/client.js').getDb>
}

export function getClient() {
  return {} as ReturnType<typeof import('../../../../packages/db/src/client.js').getClient>
}

export async function closeDb() {}
