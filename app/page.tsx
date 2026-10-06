"use client"

export const dynamic = "force-dynamic"

import { useState, useEffect, Suspense } from "react"
import { createClient } from "@/lib/supabase-browser"
import { useRouter, useSearchParams } from "next/navigation"

function LoginForm() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [forgotMode, setForgotMode] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()

  // Show a hint if the reset link was invalid
  useEffect(() => {
    if (searchParams.get("error") === "invalid-reset-link") {
      setError("That reset link is invalid or has expired. Please request a new one.")
    }
  }, [searchParams])

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) { setError(error.message); return }
      router.push("/sheet")
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: "https://ulti-gamesheet.vercel.app/auth/confirm?next=/auth/reset",
      })
      if (error) { setError(error.message); return }
      setResetSent(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-extrabold text-foreground tracking-tight">Gamesheet</h1>
          <p className="text-sm text-muted-foreground">Ultimate Frisbee</p>
        </div>

        {forgotMode ? (
          resetSent ? (
            <div className="bg-card border border-border rounded-2xl p-6 shadow-sm text-center space-y-3">
              <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">✓ Check your email</p>
              <p className="text-xs text-muted-foreground">
                A password reset link has been sent to <strong>{email}</strong>.
              </p>
              <button
                type="button"
                onClick={() => { setForgotMode(false); setResetSent(false) }}
                className="text-xs text-primary hover:underline"
              >
                Back to sign in
              </button>
            </div>
          ) : (
            <form onSubmit={handleForgot} className="space-y-4 bg-card border border-border rounded-2xl p-6 shadow-sm">
              <p className="text-xs text-muted-foreground">
                Enter your email and we'll send you a link to reset your password.
              </p>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                  autoComplete="email"
                  placeholder="coach@team.com"
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {loading ? "Sending…" : "Send Reset Link"}
              </button>
              <button
                type="button"
                onClick={() => { setForgotMode(false); setError(null) }}
                className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Back to sign in
              </button>
            </form>
          )
        ) : (
          <form onSubmit={handleLogin} className="space-y-4 bg-card border border-border rounded-2xl p-6 shadow-sm">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="coach@team.com"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Password</label>
                <button
                  type="button"
                  onClick={() => { setForgotMode(true); setError(null) }}
                  className="text-xs text-primary hover:underline"
                >
                  Forgot password?
                </button>
              </div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                placeholder="••••••••"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {loading ? "Signing in..." : "Sign In"}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
