import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { LogIn } from 'lucide-react'

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string }
        throw new Error(body.message ?? 'Login failed')
      }
      void navigate({ to: '/' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-canvas p-4">
      <form
        onSubmit={(e) => void submit(e)}
        className="w-full max-w-sm rounded-lg border border-border bg-canvas-subtle p-6 shadow-lg"
      >
        <div className="mb-6 flex items-center gap-2">
          <LogIn className="text-accent" size={24} />
          <h1 className="text-lg font-medium text-fg">Sign in to Hermes</h1>
        </div>
        {error && (
          <p className="mb-4 rounded bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>
        )}
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs text-fg-muted">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full rounded border border-border bg-canvas px-3 py-2 text-sm text-fg"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-fg-muted">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full rounded border border-border bg-canvas px-3 py-2 text-sm text-fg"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-accent py-2 text-sm text-white hover:bg-accent-emphasis disabled:opacity-50"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </div>
        <p className="mt-4 text-center text-xs text-fg-muted">
          Local dev: auth optional until server is configured.
        </p>
      </form>
    </div>
  )
}
