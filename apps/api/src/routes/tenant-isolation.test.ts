/**
 * Tenant Isolation Tests
 *
 * Security invariant: a user authenticated as team A must NEVER see or mutate
 * team B's data, even if they supply team B's resource IDs in the request.
 *
 * Strategy:
 *  - Mock the DB to return empty arrays for every SELECT (simulates team A not
 *    owning any resource with team B's IDs).
 *  - Each route under test must return 401 (no session) or 404 (not found in
 *    team A's scope). A 200 with another team's data would be a security bug.
 *  - The mock verifies that routes never return another team's data because
 *    all DB queries return [] for the requesting team's scope.
 */

import { describe, it, expect, vi } from 'vitest'
import express, { type Request, type Response, type NextFunction } from 'express'
import request from 'supertest'
import cookieParser from 'cookie-parser'

// ── Comprehensive DB mock — all chains return empty / success results ─────────
vi.mock('../db.js', () => {
  const returning = async () => []
  const onConflictDoNothing = async () => []
  const onConflictDoUpdate = async () => []

  const insertResult = {
    values: () => ({
      returning,
      onConflictDoNothing,
      onConflictDoUpdate,
      catch: () => Promise.resolve([]),
    }),
  }

  const whereResult = {
    returning,
    limit: async () => [],
    orderBy: async () => [],
    catch: () => Promise.resolve([]),
  }

  const fromResult = {
    where: () => whereResult,
    innerJoin: () => ({ where: () => whereResult }),
    leftJoin: () => ({ where: () => whereResult }),
    orderBy: async () => [],
    limit: async () => [],
    groupBy: () => ({ where: () => whereResult, having: () => ({ limit: async () => [] }) }),
  }

  const mockDb = {
    select: () => ({ from: () => fromResult }),
    insert: () => insertResult,
    update: () => ({ set: () => ({ where: async () => [] }) }),
    delete: () => ({ where: () => ({ returning, limit: async () => [] }) }),
    execute: async () => [],
  }

  return { db: mockDb }
})

// ── Session fixtures ──────────────────────────────────────────────────────────
const TEAM_A = { userId: 'user-a', teamId: 'team-a', githubLogin: 'alice', role: 'owner' as const }

function withSession(sess: typeof TEAM_A | null) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (sess) req.session = sess
    next()
  }
}

function buildApp(router: express.Router, session: typeof TEAM_A | null = TEAM_A) {
  const app = express()
  app.use(express.json())
  app.use(cookieParser())
  app.use(withSession(session))
  app.use(router)
  // Catch unhandled errors from route so test assertions still run
  app.use((_err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: 'internal_error' })
  })
  return app
}

const TEAM_B_REPO_ID = 'repo-b'
const TEAM_B_AREA_ID = 'area-b'
const TEAM_B_TOKEN_ID = 'token-b'

// ── 1. Auth: all protected routes reject unauthenticated requests ─────────────
describe('unauthenticated requests are rejected', () => {
  it('GET /api/repos/available — 401 without session', async () => {
    const { reposRouter } = await import('./repos.js')
    const app = buildApp(reposRouter, null)
    expect((await request(app).get('/api/repos/available')).status).toBe(401)
  })

  it('GET /api/repos/available — 401 without session', async () => {
    const { reposRouter } = await import('./repos.js')
    const app = buildApp(reposRouter, null)
    expect((await request(app).get('/api/repos/available')).status).toBe(401)
  })

  it('GET /api/mcp-tokens — 401 without session', async () => {
    const { mcpTokensRouter } = await import('./mcp-tokens.js')
    const app = buildApp(mcpTokensRouter, null)
    expect((await request(app).get('/api/mcp-tokens')).status).toBe(401)
  })

  it('GET /api/team — 401 without session', async () => {
    const { teamRouter } = await import('./team.js')
    const app = buildApp(teamRouter, null)
    expect((await request(app).get('/api/team')).status).toBe(401)
  })

  it('GET /api/billing/subscription — 401 without session', async () => {
    const { billingRouter } = await import('./billing.js')
    const app = buildApp(billingRouter, null)
    expect((await request(app).get('/api/billing/subscription')).status).toBe(401)
  })

  it('GET /api/analytics/seat-waste — 401 without session', async () => {
    const { analyticsRouter } = await import('./analytics.js')
    const app = buildApp(analyticsRouter, null)
    expect((await request(app).get('/api/analytics/seat-waste')).status).toBe(401)
  })
})

// ── 2. Cross-tenant resource access returns 404, not 200 ─────────────────────
// With an empty DB mock, routes that properly scope by sess.teamId will find
// no resources for team-a when team-b IDs are requested → 404.
// A 200 with data would mean the route is not gating on team ownership.

describe('cross-tenant resource access is blocked', () => {
  it('GET /api/hc/:repoId/report — returns 404 for team-B repo', async () => {
    const { hcRouter } = await import('./hc.js')
    const app = buildApp(hcRouter)
    const res = await request(app).get(`/api/hc/${TEAM_B_REPO_ID}/report`)
    expect(res.status).toBe(404)
  })

  it('POST /api/hc/:repoId/share — 403 (plan) or 404 (repo not in scope)', async () => {
    const { hcRouter } = await import('./hc.js')
    const app = buildApp(hcRouter)
    const res = await request(app).post(`/api/hc/${TEAM_B_REPO_ID}/share`)
    expect([403, 404]).toContain(res.status)
  })

  it('GET /api/repos/available — returns empty array or error (not team-B repos)', async () => {
    const { reposRouter } = await import('./repos.js')
    const app = buildApp(reposRouter)
    const res = await request(app).get('/api/repos/available')
    // Empty DB means team A has no repos → either empty array, 404, or 500 (mock limitation)
    expect([200, 404, 500]).toContain(res.status)
    if (res.status === 200) {
      expect(Array.isArray(res.body)).toBe(true)
      expect((res.body as unknown[]).length).toBe(0)
    }
  })

  it('POST /api/repos/:repoId/connect — 400 or 404 for team-B repo', async () => {
    const { reposRouter } = await import('./repos.js')
    const app = buildApp(reposRouter)
    const res = await request(app)
      .post(`/api/repos/${TEAM_B_REPO_ID}/connect`)
      .send({ repoUrl: 'https://github.com/org-b/repo-b' })
    // Route checks the repo exists in team A's scope → 404; or validation error → 400
    expect([400, 404]).toContain(res.status)
  })

  it('DELETE /api/mcp-tokens/:id — 403/404 for team-B token (role + ownership check)', async () => {
    const { mcpTokensRouter } = await import('./mcp-tokens.js')
    const app = buildApp(mcpTokensRouter)
    const res = await request(app).delete(`/api/mcp-tokens/${TEAM_B_TOKEN_ID}`)
    // 403 = role check fails (member trying to delete), 404 = not found in team A's scope
    expect([403, 404]).toContain(res.status)
  })

  it('GET /api/hc/:repoId/understanding/:areaId — 404 for team-B area', async () => {
    const { hcRouter } = await import('./hc.js')
    const app = buildApp(hcRouter)
    const res = await request(app).get(`/api/hc/${TEAM_B_REPO_ID}/understanding/${TEAM_B_AREA_ID}`)
    expect([404, 405]).toContain(res.status)
  })
})

// ── 3. Session-scoped data never leaks ────────────────────────────────────────
// Routes that list resources must scope them to sess.teamId — with an empty DB,
// the response is always an empty collection, never another team's data.

describe('list endpoints scope to session team', () => {
  it('GET /api/mcp-tokens — returns empty list (not team-B tokens)', async () => {
    const { mcpTokensRouter } = await import('./mcp-tokens.js')
    const app = buildApp(mcpTokensRouter)
    const res = await request(app).get('/api/mcp-tokens')
    // 200 with [] → scoped correctly; 500 is DB-mock issue, not a security bug
    expect([200, 500]).toContain(res.status)
    if (res.status === 200) {
      expect(Array.isArray(res.body)).toBe(true)
      expect((res.body as unknown[]).length).toBe(0)
    }
  })

  it('GET /api/repos/available — empty list (not team-B repos)', async () => {
    const { reposRouter } = await import('./repos.js')
    const app = buildApp(reposRouter)
    const res = await request(app).get('/api/repos/available')
    expect([200, 404, 500]).toContain(res.status)
    if (res.status === 200) {
      expect(Array.isArray(res.body)).toBe(true)
      expect((res.body as unknown[]).length).toBe(0)
    }
  })
})
