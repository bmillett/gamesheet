"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase-browser"
import { useRouter } from "next/navigation"

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [ready, setReady] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  // Handle the fragment-based token flow (#access_token=...&type=recovery)
  // used by older Supabase projects / default email templates.
  useEffect(() => {
    const hash = window.location.hash
    if (!hash) { setReady(true); return }

    const params = new URLSearchParams(hash.slice(1))
    const accessToken = params.get("access_token")
    const refreshToken = params.get("refresh_token")
    const type = params.get("type")

    if (type === "recovery" && accessToken && refreshToken) {
      supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
        .then(({ error }) => {
          if (error) setError("This reset link is invalid or has expired.")
          else setReady(true)
        })
    } else {
      // Arrived via the token_hash server-side route — session already set
      setReady(true)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleReset(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (password.length < 8) {
      setError("Password must be at least 8 characters.")
      return
    }
    if (password !== confirm) {
      setError("Passwords do not match.")
      return
    }

    setLoading(true)
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) { setError(error.message); return }
      setDone(true)
      setTimeout(() => router.push("/sheet"), 2000)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-extrabold text-foreground tracking-tight">Gamesheet</h1>
          <p className="text-sm text-muted-foreground">Set a new password</p>
        </div>

        {done ? (
          <div className="bg-card border border-border rounded-2xl p-6 shadow-sm text-center space-y-2">
            <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">✓ Password updated!</p>
            <p className="text-xs text-muted-foreground">Redirecting you to the app…</p>
          </div>
        ) : !ready ? (
          <div className="bg-card border border-border rounded-2xl p-6 shadow-sm text-center">
            <p className="text-xs text-muted-foreground">Verifying reset link…</p>
          </div>
        ) : (
          <form onSubmit={handleReset} className="space-y-4 bg-card border border-border rounded-2xl p-6 shadow-sm">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">New Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
                autoComplete="new-password"
                placeholder="Min. 8 characters"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Confirm Password</label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                autoComplete="new-password"
                placeholder="••••••••"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <button
              type="submit"
              disabled={loading || Boolean(error && !password)}
              className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {loading ? "Saving…" : "Set New Password"}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
