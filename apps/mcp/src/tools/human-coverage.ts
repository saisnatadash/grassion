import { eq, and, inArray } from 'drizzle-orm'
import { repos, hcCodeAreas, hcEvidenceEvents, hcPeople } from '@grassion/db'
import { db } from '../db.js'
import type { AuthContext } from '../auth.js'

export interface HumanCoverageResult {
  repo: string
  path: string
  areaPath: string
  activePeople: Array<{ githubLogin: string; coverageWeight: number }>
  dark: boolean
  isCritical: boolean
}

export async function humanCoverage(
  auth: AuthContext,
  repoNameOrOwnerSlash: string,
  path: string,
): Promise<HumanCoverageResult> {
  // Resolve repo
  const [owner, name] = repoNameOrOwnerSlash.includes('/')
    ? repoNameOrOwnerSlash.split('/', 2) as [string, string]
    : ['', repoNameOrOwnerSlash]

  const repoRows = await db
    .select()
    .from(repos)
    .where(and(eq(repos.teamId, auth.orgId), eq(repos.name, name)))
    .limit(1)
  const repo = repoRows[0]
  if (!repo) throw new Error(`Repo "${repoNameOrOwnerSlash}" not found in your Grassion organisation.`)

  // Derive area path (top-2 directory levels)
  const parts = path.replace(/^\//, '').split('/')
  const areaPath = parts.slice(0, 2).join('/')

  const areaRows = await db
    .select()
    .from(hcCodeAreas)
    .where(and(eq(hcCodeAreas.orgId, auth.orgId), eq(hcCodeAreas.repoId, repo.id), eq(hcCodeAreas.path, areaPath)))
    .limit(1)

  if (!areaRows[0]) {
    return { repo: repoNameOrOwnerSlash, path, areaPath, activePeople: [], dark: true, isCritical: false }
  }

  const area = areaRows[0]

  const [events, people] = await Promise.all([
    db.select().from(hcEvidenceEvents).where(and(eq(hcEvidenceEvents.orgId, auth.orgId), eq(hcEvidenceEvents.areaId, area.id))),
    db.select().from(hcPeople).where(and(eq(hcPeople.orgId, auth.orgId), eq(hcPeople.isActive, true))),
  ])

  const peopleMap = new Map(people.map((p) => [p.id, p]))
  const netWeights = new Map<string, number>()
  for (const ev of events) {
    netWeights.set(ev.personId, (netWeights.get(ev.personId) ?? 0) + ev.weight)
  }

  const activePeople = [...netWeights.entries()]
    .filter(([, w]) => w > 0)
    .map(([personId, weight]) => {
      const person = peopleMap.get(personId)
      if (!person) return null
      return { githubLogin: person.githubLogin, coverageWeight: Math.round(weight * 10) / 10 }
    })
    .filter((p): p is { githubLogin: string; coverageWeight: number } => p !== null)
    .sort((a: { coverageWeight: number }, b: { coverageWeight: number }) => b.coverageWeight - a.coverageWeight)

  return {
    repo: repoNameOrOwnerSlash,
    path,
    areaPath,
    activePeople,
    dark: activePeople.length === 0,
    isCritical: area.isCritical,
  }
}
