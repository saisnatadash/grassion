import { eq, and, inArray } from 'drizzle-orm'
import { repos, hcCodeAreas, hcEvidenceEvents, hcPeople } from '@grassion/db'
import { db } from '../db.js'
import type { AuthContext } from '../auth.js'

export interface DarkArea {
  path: string
  isCritical: boolean
  lastChangedAt: string | null
}

export interface DarkAreasResult {
  repo: string
  totalAreas: number
  darkAreas: DarkArea[]
  darkPct: number
}

export async function darkAreas(auth: AuthContext, repoName: string): Promise<DarkAreasResult> {
  const [owner, name] = repoName.includes('/')
    ? repoName.split('/', 2) as [string, string]
    : ['', repoName]

  const repoRows = await db
    .select()
    .from(repos)
    .where(and(eq(repos.teamId, auth.orgId), eq(repos.name, name)))
    .limit(1)
  const repo = repoRows[0]
  if (!repo) throw new Error(`Repo "${repoName}" not found in your Grassion organisation.`)

  const areas = await db
    .select()
    .from(hcCodeAreas)
    .where(and(eq(hcCodeAreas.orgId, auth.orgId), eq(hcCodeAreas.repoId, repo.id)))

  if (areas.length === 0) {
    return { repo: repoName, totalAreas: 0, darkAreas: [], darkPct: 0 }
  }

  const areaIds = areas.map((a) => a.id)
  const [events, people] = await Promise.all([
    db.select().from(hcEvidenceEvents).where(and(eq(hcEvidenceEvents.orgId, auth.orgId), inArray(hcEvidenceEvents.areaId, areaIds))),
    db.select().from(hcPeople).where(and(eq(hcPeople.orgId, auth.orgId), eq(hcPeople.isActive, true))),
  ])

  const activePeopleIds = new Set(people.map((p: { id: string }) => p.id))

  const netWeights = new Map<string, Map<string, number>>()
  for (const ev of events) {
    if (!activePeopleIds.has(ev.personId)) continue
    let areaMap = netWeights.get(ev.areaId)
    if (!areaMap) { areaMap = new Map(); netWeights.set(ev.areaId, areaMap) }
    areaMap.set(ev.personId, (areaMap.get(ev.personId) ?? 0) + ev.weight)
  }

  const dark: DarkArea[] = []
  for (const area of areas) {
    const weights = netWeights.get(area.id)
    const hasActiveCoverage = weights && [...weights.values()].some((w) => w > 0)
    if (!hasActiveCoverage) {
      dark.push({
        path: area.path,
        isCritical: area.isCritical,
        lastChangedAt: area.lastChangedAt?.toISOString() ?? null,
      })
    }
  }

  dark.sort((a: DarkArea, b: DarkArea) => (b.isCritical ? 1 : 0) - (a.isCritical ? 1 : 0))

  return {
    repo: repoName,
    totalAreas: areas.length,
    darkAreas: dark,
    darkPct: areas.length > 0 ? Math.round((dark.length / areas.length) * 100) : 0,
  }
}
