import { Router, type Request, type Response } from 'express'
import { eq, desc, and, gt } from 'drizzle-orm'
import { teamMilestones, sessions, users, repos } from '@grassion/db'
import { db } from '../db.js'
import { requireAuth } from '../auth.js'

export const securityRouter = Router()

securityRouter.get('/api/security/overview', requireAuth, async (req: Request, res: Response) => {
  const { teamId, userId, role } = req.session!

  try {
    const [milestones, activeSessions, repoRows] = await Promise.all([
      db
        .select()
        .from(teamMilestones)
        .where(eq(teamMilestones.teamId, teamId))
        .orderBy(desc(teamMilestones.achievedAt))
        .limit(10),
      db
        .select({ id: sessions.id })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(and(eq(users.teamId, teamId), gt(sessions.expiresAt, new Date()))),
      db
        .select({ name: repos.name, owner: repos.owner, connectedAt: repos.connectedAt })
        .from(repos)
        .where(eq(repos.teamId, teamId))
        .orderBy(desc(repos.connectedAt)),
    ])

    res.json({
      userId,
      role,
      activeSessionCount: activeSessions.length,
      connectedRepos: repoRows.map((r) => ({
        name: `${r.owner}/${r.name}`,
        connectedAt: r.connectedAt.toISOString(),
      })),
      milestones: milestones.map((m) => ({
        type: m.milestone,
        achievedAt: m.achievedAt.toISOString(),
      })),
      githubPermissions: [
        { scope: 'read:user', description: 'Public GitHub profile and username' },
        { scope: 'repo', description: 'Read PR metadata, commit messages, review outcomes. Cannot write, merge, or modify anything.' },
        { scope: 'read:org', description: 'Verify organisation membership. Cannot modify settings or member permissions.' },
      ],
      dataAccess: {
        reads: [
          'PR titles and descriptions',
          'Commit message text (not code diffs)',
          'Merge timestamps and dates',
          'Author GitHub usernames (public data)',
          'Review counts and approval status',
          'CI check results (pass/fail counts)',
        ],
        neverReads: [
          'Source code or file contents',
          'Secrets, API keys, or environment variables',
          'Code diffs or implementation details',
          'Private messages or issue comments',
          'Developer personal data beyond GitHub profile',
        ],
      },
    })
  } catch (err) {
    console.error('[security-overview]', err)
    res.status(500).json({ error: 'internal_error' })
  }
})
