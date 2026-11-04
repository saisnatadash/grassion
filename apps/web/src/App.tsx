import { useEffect } from 'react'
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from './components/Layout.js'
import { LoginPage } from './pages/Login.js'
import { InstallPage } from './pages/Install.js'
import { DashboardPage } from './pages/Dashboard.js'
import { SettingsPage } from './pages/Settings.js'
import { BillingPage } from './pages/Billing.js'
import { OnboardingPage } from './pages/Onboarding.js'
import { SpendIntelligencePage } from './pages/SpendIntelligence.js'
import { HealthPage } from './pages/Health.js'
import { OutcomesPage } from './pages/Outcomes.js'
import { SecurityPage } from './pages/Security.js'
import { AuthCallbackPage } from './pages/AuthCallback.js'
import { NotFoundPage } from './pages/NotFound.js'
import { DarkCodeReportPage } from './pages/DarkCodeReport.js'
import { DarkCodeReportShared } from './pages/DarkCodeReportShared.js'
import { MaReportPage } from './pages/MaReport.js'
import { AiGovernancePage } from './pages/AiGovernance.js'
import { AdminLayout } from './pages/AdminLayout.js'
import { AdminOverview } from './pages/AdminOverview.js'
import { AdminFunnel } from './pages/AdminFunnel.js'
import { AdminTeams } from './pages/AdminTeams.js'
import { AdminEngagement } from './pages/AdminEngagement.js'
import { AdminRevenue } from './pages/AdminRevenue.js'
import { AdminMarketing } from './pages/AdminMarketing.js'
import { AdminForms } from './pages/AdminForms.js'
import { AdminSystem } from './pages/AdminSystem.js'
import { AdminEvents } from './pages/AdminEvents.js'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        if ((error as { status?: number })?.status === 401) return false
        return failureCount < 2
      },
    },
  },
})

/** Forces a fresh /auth/me and /api/team fetch on every page load so the plan
 *  displayed in the UI always reflects the DB value, even if the JWT is stale. */
function AppInit() {
  const qc = useQueryClient()
  useEffect(() => {
    void qc.invalidateQueries({ queryKey: ['me'] })
    void qc.invalidateQueries({ queryKey: ['team'] })
  }, [qc])
  return null
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppInit />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
          <Route path="/install" element={<InstallPage />} />
          <Route element={<AppLayout />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/spend-intelligence" element={<SpendIntelligencePage />} />
            <Route path="/seat-waste" element={<Navigate to="/spend-intelligence" replace />} />
            <Route path="/health" element={<HealthPage />} />
            <Route path="/outcomes" element={<OutcomesPage />} />
            <Route path="/security" element={<SecurityPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/billing" element={<BillingPage />} />
            <Route path="/onboarding" element={<OnboardingPage />} />
            <Route path="/dark-code" element={<DarkCodeReportPage />} />
            <Route path="/ma-report" element={<MaReportPage />} />
            <Route path="/ai-governance" element={<AiGovernancePage />} />
          </Route>
          <Route path="/admin" element={<Navigate to="/admin/overview" replace />} />
          <Route element={<AdminLayout />}>
            <Route path="/admin/overview"   element={<AdminOverview />} />
            <Route path="/admin/funnel"     element={<AdminFunnel />} />
            <Route path="/admin/teams"      element={<AdminTeams />} />
            <Route path="/admin/engagement" element={<AdminEngagement />} />
            <Route path="/admin/revenue"    element={<AdminRevenue />} />
            <Route path="/admin/marketing"  element={<AdminMarketing />} />
            <Route path="/admin/forms"      element={<AdminForms />} />
            <Route path="/admin/system"     element={<AdminSystem />} />
            <Route path="/admin/events"     element={<AdminEvents />} />
          </Route>
          <Route path="/report/share/:token" element={<DarkCodeReportShared />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
