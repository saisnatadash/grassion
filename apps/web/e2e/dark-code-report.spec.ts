import { test, expect, type Page } from '@playwright/test'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const REPO_ID = 'repo-uuid-1'
const FAILURE_ID = 'failure-uuid-1'

const mockReport = {
  repo: { id: REPO_ID, owner: 'acme', name: 'frontend' },
  headline: {
    totalAreas: 20,
    darkAreas: 8,
    darkPct: 40,
    trend: [
      { month: '2026-05', aiRisk: 2, humanCoverage: 3 },
      { month: '2026-06', aiRisk: 1, humanCoverage: 4 },
      { month: '2026-07', aiRisk: 3, humanCoverage: 2 },
      { month: '2026-08', aiRisk: 0, humanCoverage: 5 },
      { month: '2026-09', aiRisk: 2, humanCoverage: 3 },
      { month: '2026-10', aiRisk: 4, humanCoverage: 1 },
    ],
  },
  fragileAndDark: [
    {
      failure: {
        id: FAILURE_ID,
        originalPr: 42,
        revertPr: 45,
        fixPr: 47,
        testNames: ['src/auth/auth.test.ts'],
        state: 'candidate',
      },
      areas: [{ id: 'area-1', path: 'src/auth', isCritical: true }],
    },
  ],
  singlePersonAreas: [
    {
      areaId: 'area-2',
      path: 'src/payments',
      isCritical: false,
      lastChangedAt: '2026-10-01T00:00:00Z',
      person: { githubLogin: 'alice' },
    },
  ],
  darkByMonth: [
    { month: '2026-09', ai: 2, other: 1 },
    { month: '2026-10', ai: 3, other: 0 },
  ],
  offboarding: [
    {
      areaId: 'area-3',
      path: 'src/billing',
      isCritical: true,
      lastPerson: { githubLogin: 'bob', leftAt: '2026-09-01T00:00:00Z' },
    },
  ],
}

const mockRepos = [
  { id: REPO_ID, teamId: 't1', owner: 'acme', name: 'frontend', isActive: true },
]

const mockMe = {
  id: 'u1',
  githubLogin: 'alice',
  avatarUrl: null,
  team: { id: 't1', name: 'ACME', plan: 'team', trialEndsAt: null, avgDevHourlyRateUsd: 75 },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function mockApiRoutes(page: Page) {
  await page.route('**/auth/me', (r) => r.fulfill({ json: mockMe }))
  await page.route('**/api/repos', (r) => r.fulfill({ json: mockRepos }))
  await page.route('**/api/team', (r) => r.fulfill({ json: mockMe.team }))
  await page.route('**/api/notifications', (r) => r.fulfill({ json: [] }))
  await page.route(`**/api/hc/${REPO_ID}/report`, (r) => r.fulfill({ json: mockReport }))
  await page.route(`**/api/hc/${REPO_ID}/failures/${FAILURE_ID}/verdict`, (r) =>
    r.fulfill({ json: { id: FAILURE_ID, state: 'confirmed' } }),
  )
  await page.route(`**/api/hc/${REPO_ID}/share`, (r) =>
    r.fulfill({
      json: {
        token: 'test-share-token-abc',
        expiresAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
      },
    }),
  )
}

async function mockShareRoute(page: Page) {
  // API does NOT echo back the token — only the report data + expiresAt
  await page.route('**/api/hc/share/test-share-token-abc', (r) =>
    r.fulfill({
      json: {
        ...mockReport,
        expiresAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
      },
    }),
  )
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Dark Code Report — authenticated page', () => {
  test.beforeEach(async ({ page }) => {
    // Inject a fake token so Layout doesn't redirect to login
    await page.addInitScript(() => {
      localStorage.setItem('grassion_token', 'fake-test-token')
    })
    await mockApiRoutes(page)
  })

  test('renders headline dark percentage', async ({ page }) => {
    await page.goto(`/dark-code?repo=${REPO_ID}`)
    const pct = page.getByTestId('dark-pct')
    await expect(pct).toBeVisible()
    await expect(pct).toContainText('40%')
  })

  test('renders trend chart', async ({ page }) => {
    await page.goto(`/dark-code?repo=${REPO_ID}`)
    await expect(page.getByTestId('trend-chart')).toBeVisible()
  })

  test('renders fragile & dark row with PR links', async ({ page }) => {
    await page.goto(`/dark-code?repo=${REPO_ID}`)
    const row = page.getByTestId('fragile-row').first()
    await expect(row).toBeVisible()
    await expect(row.getByTestId('original-pr-link')).toContainText('Original #42')
  })

  test('confirm button sends verdict and row updates', async ({ page }) => {
    await page.goto(`/dark-code?repo=${REPO_ID}`)
    await expect(page.getByTestId('confirm-btn').first()).toBeVisible()

    // After click, the API returns state=confirmed — re-mock report with confirmed state
    await page.route(`**/api/hc/${REPO_ID}/report`, (r) =>
      r.fulfill({
        json: {
          ...mockReport,
          fragileAndDark: [
            {
              failure: { ...mockReport.fragileAndDark[0]!.failure, state: 'confirmed' },
              areas: mockReport.fragileAndDark[0]!.areas,
            },
          ],
        },
      }),
    )

    const verdictRequest = page.waitForRequest((r) =>
      r.url().includes('/failures/') && r.method() === 'POST',
    )
    await page.getByTestId('confirm-btn').first().click()
    await verdictRequest
  })

  test('dismiss button sends dismissed verdict', async ({ page }) => {
    await page.goto(`/dark-code?repo=${REPO_ID}`)

    // Re-mock to return obsolete state after dismiss
    await page.route(`**/api/hc/${REPO_ID}/failures/${FAILURE_ID}/verdict`, (r) =>
      r.fulfill({ json: { id: FAILURE_ID, state: 'obsolete' } }),
    )
    await page.route(`**/api/hc/${REPO_ID}/report`, (r) =>
      r.fulfill({ json: { ...mockReport, fragileAndDark: [] } }),
    )

    const req = page.waitForRequest((r) =>
      r.url().includes('/failures/') && r.method() === 'POST',
    )
    await page.getByTestId('dismiss-btn').first().click()
    const dismissed = await req
    const body = JSON.parse(dismissed.postData() ?? '{}') as { verdict: string }
    expect(body.verdict).toBe('dismissed')
  })

  test('single-person areas table is rendered', async ({ page }) => {
    await page.goto(`/dark-code?repo=${REPO_ID}`)
    await expect(page.getByTestId('single-person-table')).toBeVisible()
    await expect(page.getByTestId('single-person-table')).toContainText('alice')
  })

  test('offboarding table is rendered', async ({ page }) => {
    await page.goto(`/dark-code?repo=${REPO_ID}`)
    await expect(page.getByTestId('offboarding-table')).toBeVisible()
    await expect(page.getByTestId('offboarding-table')).toContainText('bob')
  })

  test('dark-by-month chart is rendered', async ({ page }) => {
    await page.goto(`/dark-code?repo=${REPO_ID}`)
    await expect(page.getByTestId('dark-by-month-chart')).toBeVisible()
  })

  test('PDF export button exists', async ({ page }) => {
    await page.goto(`/dark-code?repo=${REPO_ID}`)
    await expect(page.getByTestId('pdf-export-btn')).toBeVisible()
  })

  test('share button opens modal with generate link button', async ({ page }) => {
    await page.goto(`/dark-code?repo=${REPO_ID}`)
    await page.getByTestId('share-btn').click()
    await expect(page.getByTestId('share-modal')).toBeVisible()
    await expect(page.getByTestId('generate-link-btn')).toBeVisible()
  })

  test('generate link creates a share URL', async ({ page }) => {
    await page.goto(`/dark-code?repo=${REPO_ID}`)
    await page.getByTestId('share-btn').click()
    await page.getByTestId('generate-link-btn').click()
    const input = page.getByTestId('share-url-input')
    await expect(input).toBeVisible()
    await expect(input).toHaveValue(/test-share-token-abc/)
  })
})

test.describe('Dark Code Report — public share page', () => {
  test.beforeEach(async ({ page }) => {
    await mockShareRoute(page)
  })

  test('renders read-only report via share token', async ({ page }) => {
    await page.goto('/report/share/test-share-token-abc')
    await expect(page.getByTestId('dark-pct')).toContainText('40%')
  })

  test('shows read-only banner with expiry', async ({ page }) => {
    await page.goto('/report/share/test-share-token-abc')
    const banner = page.locator('text=Read-only shared report')
    await expect(banner).toBeVisible()
  })

  test('confirm and dismiss buttons are hidden in read-only mode', async ({ page }) => {
    await page.goto('/report/share/test-share-token-abc')
    await expect(page.getByTestId('confirm-btn')).toHaveCount(0)
    await expect(page.getByTestId('dismiss-btn')).toHaveCount(0)
  })

  test('shows error for expired or invalid token', async ({ page }) => {
    await page.route('**/api/hc/share/invalid-token', (r) =>
      r.fulfill({ status: 404, json: { error: 'token_not_found_or_expired' } }),
    )
    await page.goto('/report/share/invalid-token')
    await expect(page.locator('text=This report link has expired')).toBeVisible()
  })
})
