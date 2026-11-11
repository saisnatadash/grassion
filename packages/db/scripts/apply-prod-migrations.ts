/**
 * One-shot script: applies all pending SQL migrations directly to the
 * production Supabase DB via the session-mode pooler (port 5432).
 * Run with: pnpm --filter @grassion/db tsx scripts/apply-prod-migrations.ts
 */
import postgres from 'postgres'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))
const sqlFile = resolve(__dir, '../../../', 'apply-migrations.sql')

// Use env DATABASE_URL but switch port to 5432 (session pooler — supports DDL)
const baseUrl = process.env.DATABASE_URL ?? process.env.DIRECT_DATABASE_URL ?? ''
if (!baseUrl) {
  console.error('No DATABASE_URL set')
  process.exit(1)
}
// Swap port 6543 → 5432 for session mode
const url = baseUrl.replace(':6543/', ':5432/')

console.log(`Connecting to: ${url.replace(/:([^:@]+)@/, ':****@')}\n`)

const sql = postgres(url, { max: 1, ssl: 'require', connect_timeout: 30, idle_timeout: 30 })

const raw = readFileSync(sqlFile, 'utf8')

/**
 * Split SQL respecting dollar-quoted strings ($$ ... $$).
 * Semicolons inside dollar-quoted blocks are NOT statement terminators.
 */
function splitSql(input: string): string[] {
  const stmts: string[] = []
  let buf = ''
  let inDollar = false
  let dollarTag = ''
  let i = 0
  while (i < input.length) {
    // Detect start/end of a dollar-quoted string
    if (!inDollar && input[i] === '$') {
      // Find the closing $ of the tag
      const end = input.indexOf('$', i + 1)
      if (end !== -1) {
        const tag = input.slice(i, end + 1) // e.g. "$$" or "$migration$"
        dollarTag = tag
        inDollar = true
        buf += input.slice(i, end + 1)
        i = end + 1
        continue
      }
    }
    if (inDollar) {
      // Look for the matching closing tag
      if (input.startsWith(dollarTag, i)) {
        buf += dollarTag
        i += dollarTag.length
        inDollar = false
        dollarTag = ''
        continue
      }
    }
    if (!inDollar && input[i] === ';') {
      const stmt = buf.trim()
      buf = ''
      i++
      const noComments = stmt.replace(/--[^\n]*/g, '').trim()
      if (noComments.length > 0) stmts.push(stmt)
      continue
    }
    buf += input[i]
    i++
  }
  const last = buf.trim()
  if (last.replace(/--[^\n]*/g, '').trim().length > 0) stmts.push(last)
  return stmts
}

const statements = splitSql(raw)

console.log(`Running ${statements.length} statements…\n`)

let ok = 0
let fail = 0
for (const stmt of statements) {
  const preview = stmt.replace(/\s+/g, ' ').slice(0, 90)
  try {
    await sql.unsafe(stmt + ';')
    console.log(`  ✓  ${preview}`)
    ok++
  } catch (err: unknown) {
    const msg = (err as { message?: string })?.message ?? String(err)
    if (msg.includes('already exists') || msg.includes('duplicate')) {
      console.log(`  ≈  ${preview}  [already exists]`)
      ok++
    } else {
      console.error(`  ✗  ${preview}`)
      console.error(`     ERROR: ${msg}\n`)
      fail++
    }
  }
}

await sql.end()
console.log(`\n${'─'.repeat(70)}`)
console.log(`Done — ${ok} OK, ${fail} failed`)
if (fail > 0) process.exit(1)
