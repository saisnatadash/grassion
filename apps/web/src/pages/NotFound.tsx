import { Link } from 'react-router-dom'
import { Button } from '../components/ui.js'

export function NotFoundPage() {
  return (
    <div className="min-h-full flex flex-col items-center justify-center text-center p-6">
      <h1 className="text-4xl font-semibold">404</h1>
      <p className="mt-2 text-neutral-600">That page doesn't exist.</p>
      <Link to="/dashboard" className="mt-4">
        <Button variant="secondary">Go to dashboard</Button>
      </Link>
    </div>
  )
}
