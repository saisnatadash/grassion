import { Github } from 'lucide-react'
import { Button } from '../components/ui.js'
import { installUrl } from '../lib/api.js'

export function InstallPage() {
  return (
    <div className="min-h-full flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border border-neutral-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight">Install Grassion on GitHub</h1>
        <p className="mt-2 text-sm text-neutral-600">
          Pick which repositories you'd like Grassion to analyze. You can change this anytime.
        </p>
        <a href={installUrl()} target="_blank" rel="noreferrer" className="mt-6 block">
          <Button className="w-full" size="lg">
            <Github className="mr-2 h-5 w-5" /> Install Grassion
          </Button>
        </a>
        <p className="mt-4 text-xs text-neutral-500">
          You'll be redirected to GitHub. After installing, return here to view your dashboard.
        </p>
      </div>
    </div>
  )
}
