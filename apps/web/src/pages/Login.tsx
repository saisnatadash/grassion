import { Github } from 'lucide-react'
import { Button } from '../components/ui.js'
import { loginUrl } from '../lib/api.js'

export function LoginPage() {
  return (
    <div className="min-h-full flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border border-neutral-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in to Grassion</h1>
        <p className="mt-2 text-sm text-neutral-600">
          Measure whether your AI coding tool spend is paying off.
        </p>
        <a href={loginUrl()} className="mt-6 block">
          <Button className="w-full" size="lg">
            <Github className="mr-2 h-5 w-5" /> Continue with GitHub
          </Button>
        </a>
        <p className="mt-4 text-xs text-neutral-500">
          We only request read-only access to your repos. No code is stored.
        </p>
      </div>
    </div>
  )
}
