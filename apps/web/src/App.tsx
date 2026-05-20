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
import { SeatWastePage } from './pages/SeatWaste.js'
import { AuthCallbackPage } from './pages/AuthCallback.js'
import { NotFoundPage } from './pages/NotFound.js'

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
            <Route path="/seat-waste" element={<SeatWastePage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/billing" element={<BillingPage />} />
            <Route path="/onboarding" element={<OnboardingPage />} />
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
