import crypto from 'node:crypto'
import { and, asc, eq } from 'drizzle-orm'
import { hcAttestationLog, hcPeople } from '@grassion/db'
import { db } from '../db.js'

function computeRowHash(
  prevHash: string,
  id: string,
  orgId: string,
  repoId: string,
  prNumber: number,
  personId: string,
  answer: string,
  createdAt: Date,
): string {
  const payload = [prevHash, id, orgId, repoId, String(prNumber), personId, answer, createdAt.toISOString()].join('|')
  return crypto.createHash('sha256').update(payload).digest('hex')
}

/** Append a reviewer self-assessment to the hash chain for a PR. */
export async function appendAttestation(params: {
  orgId: string
  repoId: string
  prNumber: number
  personId: string
  answer: string
  note?: string
}): Promise<{ id: string; rowHash: string }> {
  const { orgId, repoId, prNumber, personId, answer, note } = params

  // Get the previous row hash for this (org, pr_number) chain
  const prev = await db
    .select({ rowHash: hcAttestationLog.rowHash })
    .from(hcAttestationLog)
    .where(and(eq(hcAttestationLog.orgId, orgId), eq(hcAttestationLog.prNumber, prNumber)))
    .orderBy(asc(hcAttestationLog.createdAt))

  const prevHash = prev.length > 0 ? (prev[prev.length - 1]!.rowHash) : ''

  // Generate UUID before insert so the hash can include it
  const id = crypto.randomUUID()
  const createdAt = new Date()
  const rowHash = computeRowHash(prevHash, id, orgId, repoId, prNumber, personId, answer, createdAt)

  await db.insert(hcAttestationLog).values({ id, orgId, repoId, prNumber, personId, answer, note: note ?? null, createdAt, prevHash, rowHash })

  return { id, rowHash }
}

export interface ChainVerifyResult {
  valid: boolean
  rowCount: number
  firstTamperedAt?: string
}

/** Verify the SHA-256 hash chain for a PR. Returns valid=true if no tampering detected. */
export async function verifyAttestationChain(orgId: string, prNumber: number): Promise<ChainVerifyResult> {
  const rows = await db
    .select()
    .from(hcAttestationLog)
    .where(and(eq(hcAttestationLog.orgId, orgId), eq(hcAttestationLog.prNumber, prNumber)))
    .orderBy(asc(hcAttestationLog.createdAt))

  if (rows.length === 0) return { valid: true, rowCount: 0 }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!
    const expectedPrev = i === 0 ? '' : rows[i - 1]!.rowHash
    const expected = computeRowHash(
      expectedPrev,
      row.id,
      row.orgId,
      row.repoId,
      row.prNumber,
      row.personId,
      row.answer,
      row.createdAt,
    )
    if (expected !== row.rowHash) {
      return { valid: false, rowCount: rows.length, firstTamperedAt: row.createdAt.toISOString() }
    }
  }

  return { valid: true, rowCount: rows.length }
}

/** Fetch all attestations for a PR, joining person login. */
export async function getAttestationsForPr(orgId: string, prNumber: number) {
  const rows = await db
    .select({
      id: hcAttestationLog.id,
      answer: hcAttestationLog.answer,
      note: hcAttestationLog.note,
      createdAt: hcAttestationLog.createdAt,
      rowHash: hcAttestationLog.rowHash,
      personLogin: hcPeople.githubLogin,
    })
    .from(hcAttestationLog)
    .innerJoin(hcPeople, eq(hcPeople.id, hcAttestationLog.personId))
    .where(and(eq(hcAttestationLog.orgId, orgId), eq(hcAttestationLog.prNumber, prNumber)))
    .orderBy(asc(hcAttestationLog.createdAt))

  return rows.map((r) => ({
    id: r.id,
    personLogin: r.personLogin,
    answer: r.answer,
    note: r.note,
    createdAt: r.createdAt.toISOString(),
    rowHash: r.rowHash,
  }))
}
