import crypto from 'node:crypto'
import { eq } from 'drizzle-orm'
import { mcpApiTokens } from '@grassion/db'
import { db } from './db.js'

export interface AuthContext {
  orgId: string
  tokenId: string
}

export async function validateApiToken(rawToken: string): Promise<AuthContext | null> {
  if (!rawToken) return null
  const hash = crypto.createHash('sha256').update(rawToken).digest('hex')

  const rows = await db
    .select({ id: mcpApiTokens.id, orgId: mcpApiTokens.orgId })
    .from(mcpApiTokens)
    .where(eq(mcpApiTokens.tokenHash, hash))
    .limit(1)

  const row = rows[0]
  if (!row) return null

  // Update lastUsedAt fire-and-forget
  db.update(mcpApiTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(mcpApiTokens.id, row.id))
    .catch(() => {})

  return { orgId: row.orgId, tokenId: row.id }
}
