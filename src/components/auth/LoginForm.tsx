'use client'

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getBrowserClient } from '@/lib/supabase/browser'
import { safeNextPath } from '@/lib/auth/next-path'

// A13 sign-in. Real Supabase email/password auth (aal1), then hands off to the
// MFA step which brings the session to aal2 for the gated portals. Uses the
// cookie-backed browser client so the middleware/RSC guards see the session.
export function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const next = safeNextPath(params.get('next'))
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const fd = new FormData(e.currentTarget)
    const email = String(fd.get('email') ?? '').trim()
    const password = String(fd.get('password') ?? '')
    if (!email || !password) {
      setError('Enter your email and password.')
      return
    }

    setBusy(true)
    const supabase = getBrowserClient()
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
    if (signInError) {
      setBusy(false)
      setError('Invalid email or password.')
      return
    }

    // Password verified (aal1). If MFA is already satisfied, go straight in;
    // otherwise route to the MFA step (which enrolls a factor if none exists).
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    if (aal?.currentLevel === 'aal2') {
      router.replace(next)
      router.refresh()
      return
    }
    router.replace(`/login/mfa?next=${encodeURIComponent(next)}`)
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? 'Signing in…' : 'Continue'}
      </Button>
    </form>
  )
}
