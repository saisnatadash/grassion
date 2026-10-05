import { Router, type Request, type Response } from 'express'
import { eq, and } from 'drizzle-orm'
import {
  pullRequests,
  prOutcomes,
  prOutcomeTimeline,
  weeklySnapshots,
  developerWeeklyMetrics,
  toolWeeklyMetrics,
  codbaseHealthSnapshots,
  savingsEvents,
  teamMilestones,
  developerHistory,
  teamWeeklyMetrics,
  outcomeCheckQueue,
  repos,
  teams,
  notifications,
  engineeringEvents,
} from '@grassion/db'
import { db } from '../db.js'
import { requireAuth } from '../auth.js'
import { env } from '../env.js'
import { logger } from '../logger.js'

export const demoRouter = Router()

// ── helpers ──────────────────────────────────────────────────────────────────

function getWeekStart(weeksAgo: number): Date {
  const now = new Date()
  const daysSinceMonday = (now.getUTCDay() + 6) % 7
  return new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - daysSinceMonday - weeksAgo * 7,
  ))
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000)
}

function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0]!
}

// Stable per-team integer base for fake GitHub IDs (avoids global unique constraint collisions)
function teamBase(teamId: string): number {
  return parseInt(teamId.replace(/-/g, '').slice(0, 8), 16) % 900_000 + 700_000_000
}

async function guard(req: Request, res: Response): Promise<boolean> {
  if (env().DEMO_MODE) return true
  const teamRow = await db.select({ plan: teams.plan }).from(teams).where(eq(teams.id, req.session!.teamId)).limit(1)
  const plan = teamRow[0]?.plan
  if (plan !== 'trial') {
    res.status(403).json({ error: 'demo_not_available', message: 'Set DEMO_MODE=true or use a trial account' })
    return false
  }
  return true
}

async function deleteTeamData(teamId: string): Promise<void> {
  // pull_requests cascade-deletes: prOutcomes, prOutcomeTimeline, outcomeCheckQueue
  await db.delete(pullRequests).where(eq(pullRequests.teamId, teamId))
  await Promise.all([
    db.delete(weeklySnapshots).where(eq(weeklySnapshots.teamId, teamId)),
    db.delete(developerWeeklyMetrics).where(eq(developerWeeklyMetrics.teamId, teamId)),
    db.delete(toolWeeklyMetrics).where(eq(toolWeeklyMetrics.teamId, teamId)),
    db.delete(codbaseHealthSnapshots).where(eq(codbaseHealthSnapshots.teamId, teamId)),
    db.delete(savingsEvents).where(eq(savingsEvents.teamId, teamId)),
    db.delete(teamMilestones).where(eq(teamMilestones.teamId, teamId)),
    db.delete(developerHistory).where(eq(developerHistory.teamId, teamId)),
    db.delete(teamWeeklyMetrics).where(eq(teamWeeklyMetrics.teamId, teamId)),
    db.delete(notifications).where(eq(notifications.teamId, teamId)),
    db.delete(engineeringEvents).where(eq(engineeringEvents.teamId, teamId)),
    db.delete(repos).where(and(eq(repos.teamId, teamId), eq(repos.owner, 'grassion-demo'))),
  ])
}

// ── POST /api/demo/seed ───────────────────────────────────────────────────────

demoRouter.post('/api/demo/seed', requireAuth, async (req: Request, res: Response) => {
  if (!await guard(req, res)) return
  const teamId = req.session!.teamId

  try {
    // 1. Wipe previous demo data
    await deleteTeamData(teamId)

    // 2. Create demo repo
    const base = teamBase(teamId)
    const [demoRepo] = await db.insert(repos).values({
      teamId,
      githubRepoId: base,
      owner: 'grassion-demo',
      name: 'acme-platform',
      defaultBranch: 'main',
      isActive: true,
    }).returning()
    const repoId = demoRepo!.id

    // 3. Build PR data
    type PrSpec = {
      weeksAgo: number; dayOffset: number; author: string
      aiSource: string | null; method: string | null; title: string
      reverted?: true; hotfix?: true; downstreamFix?: true
    }

    const specs: PrSpec[] = [
      // W8 — 7 weeks ago: just started, 2 PRs, 1 AI
      { weeksAgo: 7, dayOffset: 2, author: 'alex-dev',        aiSource: null,       method: null,      title: 'Add user authentication middleware' },
      { weeksAgo: 7, dayOffset: 3, author: 'sarah-eng',       aiSource: 'Copilot',  method: 'label',   title: 'Implement login flow with Copilot assist' },

      // W7 — 6 weeks ago: 2 PRs, 1 AI
      { weeksAgo: 6, dayOffset: 2, author: 'mike-backend',    aiSource: null,       method: null,      title: 'Fix database connection pooling' },
      { weeksAgo: 6, dayOffset: 4, author: 'priya-frontend',  aiSource: 'Copilot',  method: 'trailer', title: 'Dashboard layout — built with Copilot' },

      // W6 — 5 weeks ago: 3 PRs, 2 AI — adoption growing
      { weeksAgo: 5, dayOffset: 1, author: 'alex-dev',        aiSource: 'Copilot',  method: 'label',   title: 'User profile page (Copilot)' },
      { weeksAgo: 5, dayOffset: 2, author: 'sarah-eng',       aiSource: 'Cursor',   method: 'label',   title: 'API endpoint refactor via Cursor' },
      { weeksAgo: 5, dayOffset: 3, author: 'mike-backend',    aiSource: null,       method: null,      title: 'Add missing database indexes' },

      // W5 — 4 weeks ago: 3 PRs, 2 AI, 1 downstream fix detected
      { weeksAgo: 4, dayOffset: 1, author: 'priya-frontend',  aiSource: 'Copilot',  method: 'label',   title: 'Notification system (Copilot)' },
      { weeksAgo: 4, dayOffset: 2, author: 'alex-dev',        aiSource: 'Cursor',   method: 'trailer', title: 'Search feature — Cursor', downstreamFix: true },
      { weeksAgo: 4, dayOffset: 4, author: 'sarah-eng',       aiSource: null,       method: null,      title: 'Fix search result ordering edge case' },

      // W4 — 3 weeks ago: 4 PRs, 3 AI, 1 REVERTED (peak adoption, quality dip)
      { weeksAgo: 3, dayOffset: 1, author: 'mike-backend',    aiSource: 'Copilot',  method: 'label',   title: 'Payment webhook handler (Copilot)' },
      { weeksAgo: 3, dayOffset: 2, author: 'priya-frontend',  aiSource: 'Cursor',   method: 'label',   title: 'Checkout flow — Cursor' },
      { weeksAgo: 3, dayOffset: 3, author: 'alex-dev',        aiSource: 'Claude',   method: 'trailer', title: 'Complex data pipeline — Claude', reverted: true },
      { weeksAgo: 3, dayOffset: 4, author: 'sarah-eng',       aiSource: null,       method: null,      title: 'Code quality and linting fixes' },

      // W3 — 2 weeks ago: 4 PRs, 3 AI, 1 HOTFIX, 2 inactive devs
      { weeksAgo: 2, dayOffset: 1, author: 'priya-frontend',  aiSource: 'Copilot',  method: 'label',   title: 'Analytics dashboard (Copilot)' },
      { weeksAgo: 2, dayOffset: 2, author: 'alex-dev',        aiSource: 'Claude',   method: 'label',   title: 'ML pipeline integration — Claude' },
      { weeksAgo: 2, dayOffset: 3, author: 'sarah-eng',       aiSource: 'Cursor',   method: 'trailer', title: 'Real-time feed — Cursor', hotfix: true },
      { weeksAgo: 2, dayOffset: 4, author: 'mike-backend',    aiSource: null,       method: null,      title: 'Fix connection timeout under load' },

      // W2 — 1 week ago: 4 PRs, 3 AI — recovery, optimisation
      { weeksAgo: 1, dayOffset: 1, author: 'alex-dev',        aiSource: 'Copilot',  method: 'label',   title: 'Reporting module (Copilot)' },
      { weeksAgo: 1, dayOffset: 2, author: 'sarah-eng',       aiSource: 'Cursor',   method: 'label',   title: 'Export feature — Cursor' },
      { weeksAgo: 1, dayOffset: 3, author: 'priya-frontend',  aiSource: 'Claude',   method: 'trailer', title: 'Onboarding flow — Claude' },
      { weeksAgo: 1, dayOffset: 4, author: 'mike-backend',    aiSource: null,       method: null,      title: 'Infrastructure cost optimisations' },

      // W1 — current week: 3 PRs, 2 AI
      { weeksAgo: 0, dayOffset: 1, author: 'alex-dev',        aiSource: 'Copilot',  method: 'label',   title: 'Performance improvements (Copilot)' },
      { weeksAgo: 0, dayOffset: 2, author: 'sarah-eng',       aiSource: 'Cursor',   method: 'label',   title: 'New dashboard view — Cursor' },
      { weeksAgo: 0, dayOffset: 3, author: 'priya-frontend',  aiSource: null,       method: null,      title: 'Fix mobile responsive layout' },
    ]

    // 4. Insert pull_requests
    const now = Date.now()
    const prRows = specs.map((s, i) => {
      const ws = getWeekStart(s.weeksAgo)
      const mergedAt = addDays(ws, s.dayOffset)
      return {
        teamId,
        repoId,
        githubPrId: base + i + 1,
        githubPrNumber: i + 1,
        title: s.title,
        state: 'merged' as const,
        authorLogin: s.author,
        openedAt: addDays(mergedAt, -1),
        mergedAt,
        additions: 80 + i * 12,
        deletions: 20 + i * 4,
        changedFiles: 3 + (i % 5),
        commitCount: 2 + (i % 3),
        aiSource: s.aiSource,
        aiDetectionMethod: s.method,
        aiConfidence: s.aiSource ? 0.92 : 0,
        reviewCount: 1 + (i % 3),
        changesRequestedCount: s.downstreamFix ? 1 : 0,
        wasReverted: s.reverted === true,
        triggeredHotfix: s.hotfix === true,
        createdAt: new Date(now - i * 100),
        updatedAt: new Date(now - i * 100),
      }
    })
    const insertedPrs = await db.insert(pullRequests).values(prRows).returning({ id: pullRequests.id, mergedAt: pullRequests.mergedAt, aiSource: pullRequests.aiSource })

    // 5. pr_outcomes + pr_outcome_timeline for PRs older than 7 days
    const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000)

    const outcomeRows: Array<typeof prOutcomes.$inferInsert> = []
    const timelineRows: Array<typeof prOutcomeTimeline.$inferInsert> = []
    const queueRows: Array<typeof outcomeCheckQueue.$inferInsert> = []

    for (let i = 0; i < insertedPrs.length; i++) {
      const pr = insertedPrs[i]!
      const spec = specs[i]!
      const mergedAt = pr.mergedAt!
      if (mergedAt >= sevenDaysAgo) continue // too recent

      const daysSinceMerge = Math.floor((Date.now() - mergedAt.getTime()) / 86_400_000)
      const hasReverted = spec.reverted === true
      const hasHotfix = spec.hotfix === true
      const hasDownstream = spec.downstreamFix === true
      const reworkScore = hasReverted ? 85 : hasHotfix ? 55 : hasDownstream ? 40 : spec.aiSource ? 8 : 5

      outcomeRows.push({
        prId: pr.id,
        teamId,
        wasReverted: hasReverted,
        revertedAt: hasReverted ? addDays(mergedAt, 2) : null,
        revertPrNumber: hasReverted ? specs.findIndex(s => s.weeksAgo < spec.weeksAgo) + 100 : null,
        ciFailureCount: hasReverted ? 2 : 0,
        downstreamFixCount: hasDownstream ? 1 : 0,
        downstreamFixPrNumbers: hasDownstream ? [i + 100] : null,
        hadHotfixWithin7d: hasHotfix,
        hotfixSignals: hasHotfix ? ['hotfix: true'] : [],
        reworkScore,
        computedAt: new Date(),
      })

      // pr_outcome_timeline checkpoints
      const checkpoints = daysSinceMerge >= 30 ? [7, 14, 30]
        : daysSinceMerge >= 14 ? [7, 14]
        : [7]

      for (const cp of checkpoints) {
        timelineRows.push({
          prId: pr.id,
          teamId,
          checkpointDays: cp,
          reworkScore: cp === 7 ? reworkScore * 0.5 : cp === 14 ? reworkScore * 0.8 : reworkScore,
          wasReverted: hasReverted,
          ciFailureCount: hasReverted ? (cp >= 14 ? 2 : 1) : 0,
          downstreamFixCount: hasDownstream ? 1 : 0,
          hadHotfix: hasHotfix,
          hotfixSignals: hasHotfix ? ['hotfix: true'] : [],
          dollarImpact: hasReverted ? -225 : hasHotfix ? -150 : spec.aiSource ? 90 : 0,
          computedAt: addDays(mergedAt, cp),
        })
      }

      // mark queue rows complete
      for (const cp of [7, 14, 30]) {
        if (daysSinceMerge >= cp) {
          queueRows.push({
            prId: pr.id,
            checkpointDays: cp,
            runAfter: addDays(mergedAt, cp),
            completedAt: addDays(mergedAt, cp),
            attempts: 1,
          })
        }
      }
    }

    if (outcomeRows.length > 0) await db.insert(prOutcomes).values(outcomeRows)
    if (timelineRows.length > 0) await db.insert(prOutcomeTimeline).values(timelineRows)
    if (queueRows.length > 0) await db.insert(outcomeCheckQueue).values(queueRows).onConflictDoNothing()

    // 6. weekly_snapshots (8 weeks)
    type WeekData = { aiPrs: number; totalPrs: number; activeSeats: number; inactiveSeats: number; netRoi: number; verdict: string }
    const weeklyData: WeekData[] = [
      { aiPrs: 1, totalPrs: 2, activeSeats: 4, inactiveSeats: 0, netRoi:   56, verdict: 'net_positive' },
      { aiPrs: 1, totalPrs: 2, activeSeats: 4, inactiveSeats: 0, netRoi:   56, verdict: 'net_positive' },
      { aiPrs: 2, totalPrs: 3, activeSeats: 4, inactiveSeats: 0, netRoi:  131, verdict: 'net_positive' },
      { aiPrs: 2, totalPrs: 3, activeSeats: 4, inactiveSeats: 0, netRoi:  131, verdict: 'net_positive' },
      { aiPrs: 3, totalPrs: 4, activeSeats: 2, inactiveSeats: 2, netRoi:  -41, verdict: 'net_negative' }, // revert + 2 inactive
      { aiPrs: 3, totalPrs: 4, activeSeats: 2, inactiveSeats: 2, netRoi:   18, verdict: 'unclear'      }, // hotfix recovery
      { aiPrs: 3, totalPrs: 4, activeSeats: 3, inactiveSeats: 1, netRoi:  206, verdict: 'net_positive' }, // 1 removed
      { aiPrs: 2, totalPrs: 3, activeSeats: 4, inactiveSeats: 0, netRoi:  131, verdict: 'net_positive' }, // current
    ]
    const snapshotRows = weeklyData.map((w, i) => ({
      teamId,
      weekStart: getWeekStart(7 - i),
      totalSeats: w.activeSeats + w.inactiveSeats,
      activeSeats: w.activeSeats,
      inactiveSeats: w.inactiveSeats,
      aiPrs: w.aiPrs,
      totalPrs: w.totalPrs,
      aiAdoptionPct: w.totalPrs > 0 ? w.aiPrs / w.totalPrs : 0,
      monthlyWasteUsd: w.inactiveSeats * 19 * 4,
      netRoiUsd: w.netRoi,
      verdict: w.verdict,
    }))
    await db.insert(weeklySnapshots).values(snapshotRows).onConflictDoNothing()

    // 7. developer_weekly_metrics (4 devs × 8 weeks)
    const devs = ['alex-dev', 'sarah-eng', 'mike-backend', 'priya-frontend']
    type DevWeekData = {
      alex: { ai: number; total: number; quality: number; active: boolean; tool: string | null }
      sarah: { ai: number; total: number; quality: number; active: boolean; tool: string | null }
      mike: { ai: number; total: number; quality: number; active: boolean; tool: string | null }
      priya: { ai: number; total: number; quality: number; active: boolean; tool: string | null }
    }
    const devWeeklyData: DevWeekData[] = [
      // W8 7ago
      { alex: { ai:0, total:1, quality:70, active:true,  tool:null       },
        sarah:{ ai:1, total:1, quality:80, active:true,  tool:'Copilot'  },
        mike: { ai:0, total:0, quality:0,  active:false, tool:null       },
        priya:{ ai:0, total:0, quality:0,  active:false, tool:null       } },
      // W7 6ago
      { alex: { ai:0, total:0, quality:0,  active:false, tool:null       },
        sarah:{ ai:0, total:0, quality:0,  active:false, tool:null       },
        mike: { ai:0, total:1, quality:68, active:true,  tool:null       },
        priya:{ ai:1, total:1, quality:78, active:true,  tool:'Copilot'  } },
      // W6 5ago
      { alex: { ai:1, total:1, quality:82, active:true,  tool:'Copilot'  },
        sarah:{ ai:1, total:1, quality:79, active:true,  tool:'Cursor'   },
        mike: { ai:0, total:1, quality:65, active:true,  tool:null       },
        priya:{ ai:0, total:0, quality:0,  active:false, tool:null       } },
      // W5 4ago
      { alex: { ai:1, total:1, quality:81, active:true,  tool:'Cursor'   },
        sarah:{ ai:0, total:1, quality:66, active:true,  tool:null       },
        mike: { ai:0, total:0, quality:0,  active:false, tool:null       },
        priya:{ ai:1, total:1, quality:80, active:true,  tool:'Copilot'  } },
      // W4 3ago — quality dip
      { alex: { ai:1, total:1, quality:30, active:true,  tool:'Claude'   }, // reverted PR
        sarah:{ ai:0, total:1, quality:62, active:true,  tool:null       },
        mike: { ai:1, total:1, quality:76, active:true,  tool:'Copilot'  },
        priya:{ ai:1, total:1, quality:74, active:true,  tool:'Cursor'   } },
      // W3 2ago — hotfix, 2 inactive
      { alex: { ai:1, total:1, quality:78, active:true,  tool:'Claude'   },
        sarah:{ ai:1, total:1, quality:45, active:true,  tool:'Cursor'   }, // hotfix
        mike: { ai:0, total:1, quality:60, active:false, tool:null       }, // inactive
        priya:{ ai:1, total:1, quality:77, active:true,  tool:'Copilot'  } },
      // W2 1ago — recovery
      { alex: { ai:1, total:1, quality:85, active:true,  tool:'Copilot'  },
        sarah:{ ai:1, total:1, quality:83, active:true,  tool:'Cursor'   },
        mike: { ai:0, total:1, quality:69, active:false, tool:null       }, // still inactive
        priya:{ ai:1, total:1, quality:82, active:true,  tool:'Claude'   } },
      // W1 current
      { alex: { ai:1, total:1, quality:88, active:true,  tool:'Copilot'  },
        sarah:{ ai:1, total:1, quality:86, active:true,  tool:'Cursor'   },
        mike: { ai:0, total:0, quality:0,  active:false, tool:null       },
        priya:{ ai:0, total:1, quality:71, active:true,  tool:null       } },
    ]

    const devMetricRows: Array<typeof developerWeeklyMetrics.$inferInsert> = []
    const devHistoryRows: Array<typeof developerHistory.$inferInsert> = []
    const keys = ['alex', 'sarah', 'mike', 'priya'] as const
    const loginMap: Record<typeof keys[number], string> = {
      alex: 'alex-dev', sarah: 'sarah-eng', mike: 'mike-backend', priya: 'priya-frontend',
    }

    for (let wi = 0; wi < 8; wi++) {
      const ws = getWeekStart(7 - wi)
      const wd = devWeeklyData[wi]!
      for (const key of keys) {
        const d = wd[key]
        const login = loginMap[key]
        devMetricRows.push({
          teamId,
          githubLogin: login,
          weekStart: toDateStr(ws),
          totalPrs: d.total,
          aiPrs: d.ai,
          revertedPrs: key === 'alex' && wi === 4 ? 1 : 0,
          hotfixPrs: key === 'sarah' && wi === 5 ? 1 : 0,
          avgReviewCycles: 1.2,
          avgPrSize: 120,
          aiConfidenceAvg: d.ai > 0 ? 0.92 : 0,
          qualityScore: d.quality,
          isActive: d.active,
          primaryAiTool: d.tool,
        })
        devHistoryRows.push({
          teamId,
          githubLogin: login,
          weekStart: ws,
          aiPrCount: d.ai,
          totalPrCount: d.total,
          isActive: d.active,
        })
      }
    }
    await db.insert(developerWeeklyMetrics).values(devMetricRows).onConflictDoNothing()
    await db.insert(developerHistory).values(devHistoryRows).onConflictDoNothing()

    // 8. tool_weekly_metrics (Copilot + Cursor, 8 weeks)
    const toolRows: Array<typeof toolWeeklyMetrics.$inferInsert> = []
    type ToolWeekData = { copilot: { prs: number; reverts: number; hotfixes: number; quality: number; users: number }; cursor: { prs: number; reverts: number; hotfixes: number; quality: number; users: number } }
    const toolWeeklyData: ToolWeekData[] = [
      { copilot: { prs:1, reverts:0, hotfixes:0, quality:80, users:1 }, cursor: { prs:0, reverts:0, hotfixes:0, quality:0,  users:0 } },
      { copilot: { prs:1, reverts:0, hotfixes:0, quality:78, users:1 }, cursor: { prs:0, reverts:0, hotfixes:0, quality:0,  users:0 } },
      { copilot: { prs:1, reverts:0, hotfixes:0, quality:82, users:1 }, cursor: { prs:1, reverts:0, hotfixes:0, quality:79, users:1 } },
      { copilot: { prs:1, reverts:0, hotfixes:0, quality:80, users:1 }, cursor: { prs:1, reverts:0, hotfixes:0, quality:81, users:1 } },
      { copilot: { prs:1, reverts:0, hotfixes:0, quality:76, users:1 }, cursor: { prs:1, reverts:0, hotfixes:0, quality:74, users:1 } },
      { copilot: { prs:1, reverts:0, hotfixes:0, quality:77, users:1 }, cursor: { prs:1, reverts:1, hotfixes:1, quality:45, users:1 } },
      { copilot: { prs:1, reverts:0, hotfixes:0, quality:85, users:1 }, cursor: { prs:1, reverts:0, hotfixes:0, quality:83, users:1 } },
      { copilot: { prs:1, reverts:0, hotfixes:0, quality:88, users:1 }, cursor: { prs:1, reverts:0, hotfixes:0, quality:86, users:1 } },
    ]
    for (let wi = 0; wi < 8; wi++) {
      const ws = toDateStr(getWeekStart(7 - wi))
      const td = toolWeeklyData[wi]!
      toolRows.push({
        teamId, toolName: 'Copilot', weekStart: ws,
        prCount: td.copilot.prs, revertCount: td.copilot.reverts, hotfixCount: td.copilot.hotfixes,
        avgChangesRequested: 1.0, qualityScore: td.copilot.quality,
        estimatedSpendUsd: td.copilot.users * 10, activeUsers: td.copilot.users,
      })
      if (td.cursor.users > 0) {
        toolRows.push({
          teamId, toolName: 'Cursor', weekStart: ws,
          prCount: td.cursor.prs, revertCount: td.cursor.reverts, hotfixCount: td.cursor.hotfixes,
          avgChangesRequested: 1.1, qualityScore: td.cursor.quality,
          estimatedSpendUsd: td.cursor.users * 20, activeUsers: td.cursor.users,
        })
      }
    }
    await db.insert(toolWeeklyMetrics).values(toolRows).onConflictDoNothing()

    // 9. codebase_health_snapshots (8 weeks)
    const healthData = [
      { score: 72, adoption: 50,  revertRate: 0,  hotfixRate: 0,  risk: 'low'    },
      { score: 73, adoption: 50,  revertRate: 0,  hotfixRate: 0,  risk: 'low'    },
      { score: 76, adoption: 67,  revertRate: 0,  hotfixRate: 0,  risk: 'low'    },
      { score: 78, adoption: 67,  revertRate: 0,  hotfixRate: 0,  risk: 'low'    },
      { score: 51, adoption: 75,  revertRate: 33, hotfixRate: 0,  risk: 'high'   },
      { score: 59, adoption: 75,  revertRate: 0,  hotfixRate: 33, risk: 'medium' },
      { score: 82, adoption: 75,  revertRate: 0,  hotfixRate: 0,  risk: 'low'    },
      { score: 84, adoption: 67,  revertRate: 0,  hotfixRate: 0,  risk: 'low'    },
    ]
    const healthRows = healthData.map((h, i) => ({
      teamId,
      snapshotDate: toDateStr(getWeekStart(7 - i)),
      overallHealthScore: h.score,
      aiAdoptionPct: h.adoption,
      revertRatePct: h.revertRate,
      hotfixRatePct: h.hotfixRate,
      avgPrQuality: h.score,
      activeDevelopers: h.score > 60 ? 4 : 2,
      totalDevelopers: 4,
      riskLevel: h.risk,
    }))
    await db.insert(codbaseHealthSnapshots).values(healthRows).onConflictDoNothing()

    // 10. savings_events — inactive seats detected in W4 and W3
    await db.insert(savingsEvents).values([
      { teamId, inactiveCount: 2, monthlyWasteUsd: 2 * 19 * 4, detectedAt: addDays(getWeekStart(3), 2) },
      { teamId, inactiveCount: 1, monthlyWasteUsd: 1 * 19 * 4, detectedAt: addDays(getWeekStart(1), 2) },
    ])

    // 11. team_milestones
    const firstAiPrDate = addDays(getWeekStart(7), 3)
    await db.insert(teamMilestones).values([
      { teamId, milestone: 'first_ai_pr',    achievedAt: firstAiPrDate },
      { teamId, milestone: 'adoption_50pct', achievedAt: addDays(getWeekStart(3), 1) },
      { teamId, milestone: 'roi_positive',   achievedAt: addDays(getWeekStart(7), 3) },
    ]).onConflictDoNothing()

    // 12. team_weekly_metrics cache
    const twmRows = weeklyData.map((w, i) => ({
      teamId,
      weekStart: getWeekStart(7 - i),
      totalPrs: w.totalPrs,
      aiPrs: w.aiPrs,
      humanPrs: w.totalPrs - w.aiPrs,
      aiAvgMergeHours: 6,
      humanAvgMergeHours: 10,
      aiReworkRate: w.netRoi < 0 ? 0.33 : 0,
      humanReworkRate: 0,
      estimatedHoursSaved: w.aiPrs * 1.2,
      estimatedHoursLost: w.netRoi < 0 ? 3 : 0,
      estimatedDollarSaved: w.aiPrs * 90,
      estimatedDollarLost: w.netRoi < 0 ? 225 : 0,
      verdict: w.verdict,
    }))
    await db.insert(teamWeeklyMetrics).values(twmRows).onConflictDoNothing()

    // 13. Set demoMode = true on the team
    await db.update(teams).set({ demoMode: true, updatedAt: new Date() }).where(eq(teams.id, teamId))

    const totalSavings = weeklyData.reduce((s, w) => s + Math.max(0, w.netRoi), 0)

    logger.info({ teamId, prs: specs.length }, 'demo data seeded')
    res.json({ seeded: true, summary: { prs: specs.length, weeks: 8, totalSavings } })
  } catch (err) {
    logger.error({ err }, 'demo seed failed')
    res.status(500).json({ error: 'internal_error' })
  }
})

// ── DELETE /api/demo/reset ────────────────────────────────────────────────────

demoRouter.delete('/api/demo/reset', requireAuth, async (req: Request, res: Response) => {
  if (!await guard(req, res)) return
  const teamId = req.session!.teamId

  try {
    await deleteTeamData(teamId)
    await db.update(teams).set({ demoMode: false, updatedAt: new Date() }).where(eq(teams.id, teamId))
    logger.info({ teamId }, 'demo data reset')
    res.json({ reset: true })
  } catch (err) {
    logger.error({ err }, 'demo reset failed')
    res.status(500).json({ error: 'internal_error' })
  }
})
