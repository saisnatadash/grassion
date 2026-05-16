import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from './components/Layout.js'
import { LoginPage } from './pages/Login.js'
import { InstallPage } from './pages/Install.js'
import { DashboardPage } from './pages/Dashboard.js'
import { SettingsPage } from './pages/Settings.js'
import { BillingPage } from './pages/Billing.js'
import { OnboardingPage } from './pages/Onboarding.js'
import { SeatWastePage } from './pages/SeatWaste.js'
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

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/login" element={<LoginPage />} />
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
