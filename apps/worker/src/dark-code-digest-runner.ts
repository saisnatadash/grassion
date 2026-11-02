import { eq, and, inArray } from 'drizzle-orm'
import {
  teams,
  users,
  repos,
  hcPeople,
  hcCodeAreas,
  hcEvidenceEvents,
  hcFailures,
} from '@grassion/db'
import { db } from './db.js'
import { logger } from './logger.js'
import { env } from './env.js'
import {
  darkCodeDigestSubject,
  darkCodeDigestText,
  darkCodeDigestHtml,
  type DarkCodeDigestData,
} from './emails/dark-code-digest.js'
import { sendEmail } from './emails/send.js'

function isProPlan(plan: string): boolean {
  return plan === 'pro' || plan === 'team' || plan === 'growth' || plan === 'business' || plan === 'enterprise'
}

async function buildDigestData(teamId: string): Promise<DarkCodeDigestData | null> {
  const [team] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1)
  if (!team || !isProPlan(team.plan)) return null

  const teamRepos = await db.select().from(repos).where(and(eq(repos.teamId, teamId), eq(repos.isActive, true)))
  if (teamRepos.length === 0) return null

  const repoIds = teamRepos.map((r) => r.id)

  const [areas, people, failures] = await Promise.all([
    db.select().from(hcCodeAreas).where(and(eq(hcCodeAreas.orgId, teamId), inArray(hcCodeAreas.repoId, repoIds))),
    db.select().from(hcPeople).where(eq(hcPeople.orgId, teamId)),
    db.select().from(hcFailures).where(and(eq(hcFailures.orgId, teamId), inArray(hcFailures.repoId, repoIds))),
  ])

  if (areas.length === 0) return null

  const areaIds = areas.map((a) => a.id)
  const events = await db
    .select()
    .from(hcEvidenceEvents)
    .where(and(eq(hcEvidenceEvents.orgId, teamId), inArray(hcEvidenceEvents.areaId, areaIds)))

  const peopleMap = new Map(people.map((p) => [p.id, p]))
  const activePeople = people.filter((p) => p.isActive)

  // Net weight per area per person
  const netWeights = new Map<string, Map<string, number>>()
  for (const ev of events) {
    let areaMap = netWeights.get(ev.areaId)
    if (!areaMap) { areaMap = new Map(); netWeights.set(ev.areaId, areaMap) }
    areaMap.set(ev.personId, (areaMap.get(ev.personId) ?? 0) + ev.weight)
  }

  let darkAreas = 0
  let criticalDarkAreas = 0
  const singlePersonAreaCount = { count: 0 }
  const newFragileAreas: DarkCodeDigestData['newFragileAreas'] = []
  const lostCoverageAreas: DarkCodeDigestData['lostCoverageAreas'] = []

  for (const area of areas) {
    const areaWeights = netWeights.get(area.id)
    const activeCovers: string[] = []

    if (areaWeights) {
      for (const [personId, weight] of areaWeights) {
        if (weight <= 0) continue
        const person = peopleMap.get(personId)
        if (person?.isActive) activeCovers.push(personId)
      }
    }

    if (activeCovers.length === 0) {
      darkAreas++
      if (area.isCritical) criticalDarkAreas++

      // Check if there was inactive coverage (lost coverage case)
      const inactiveCovers: string[] = []
      if (areaWeights) {
        for (const [personId, weight] of areaWeights) {
          if (weight <= 0) continue
          const person = peopleMap.get(personId)
          if (person && !person.isActive) inactiveCovers.push(personId)
        }
      }

      if (inactiveCovers.length > 0) {
        // Find the most recently inactive person
        let latest: { login: string; leftAt: Date | null } | null = null
        for (const personId of inactiveCovers) {
          const person = peopleMap.get(personId)
          if (!person) continue
          if (!latest || (person.leftAt && (!latest.leftAt || person.leftAt > latest.leftAt))) {
            latest = { login: person.githubLogin, leftAt: person.leftAt ?? null }
          }
        }
        if (latest) {
          lostCoverageAreas.push({ path: area.path, lastPerson: latest.login })
        }
      }
    } else if (activeCovers.length === 1) {
      singlePersonAreaCount.count++
    }

    // Fragile = has non-obsolete failure linked to this area
    const hasPastFailure = failures.some((f) => {
      if (f.state === 'obsolete') return false
      return (f.areaIds as string[]).includes(area.id)
    })
    if (hasPastFailure && activeCovers.length > 0) {
      newFragileAreas.push({ path: area.path, isCritical: area.isCritical })
    }
  }

  const totalAreas = areas.length
  const darkPct = totalAreas > 0 ? Math.round((darkAreas / totalAreas) * 100) : 0

  return {
    teamName: team.name,
    darkPct,
    prevDarkPct: null, // Could be computed from hcCoverageSnapshots if available
    totalAreas,
    darkAreas,
    criticalDarkAreas,
    singlePersonAreas: singlePersonAreaCount.count,
    newFragileAreas: newFragileAreas.slice(0, 10),
    lostCoverageAreas: lostCoverageAreas.slice(0, 10),
    appUrl: env().APP_URL,
  }
}

export async function sendDarkCodeDigestForAllProTeams(): Promise<void> {
  const allTeams = await db
    .select({ id: teams.id, plan: teams.plan })
    .from(teams)
    .where(eq(teams.emailDigestEnabled, true))

  const proTeams = allTeams.filter((t) => isProPlan(t.plan))

  for (const team of proTeams) {
    try {
      await sendDarkCodeDigestForTeam(team.id)
    } catch (err) {
      logger.error({ err, teamId: team.id }, 'dark-code digest failed for team')
    }
  }
}

export async function sendDarkCodeDigestForTeam(teamId: string): Promise<void> {
  const data = await buildDigestData(teamId)
  if (!data) return

  // Only send if there's something meaningful to report
  if (data.totalAreas === 0) return

  const adminUsers = await db
    .select({ email: users.email })
    .from(users)
    .where(and(eq(users.teamId, teamId), eq(users.role, 'admin')))

  const emails = adminUsers
    .map((u) => u.email)
    .filter((e): e is string => !!e)

  if (emails.length === 0) {
    // Fall back to all team members if no admins have email
    const allUsers = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.teamId, teamId))
    emails.push(...allUsers.map((u) => u.email).filter((e): e is string => !!e))
  }

  if (emails.length === 0) {
    logger.info({ teamId }, 'dark-code digest: no email recipients, skipping')
    return
  }

  await sendEmail({
    to: emails,
    subject: darkCodeDigestSubject(data),
    text: darkCodeDigestText(data),
    html: darkCodeDigestHtml(data),
  })

  logger.info({ teamId, recipients: emails.length, darkPct: data.darkPct }, 'dark-code digest sent')
}
