'use client'

import * as React from 'react'
import Link from 'next/link'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getBrowserClient } from '@/lib/supabase/browser'

/**
 * Set-a-new-password step of the recovery flow. The user arrives here from the
 * Supabase reset email; the cookie-backed browser client establishes a recovery
 * session from the link (surfaced via the PASSWORD_RECOVERY auth event). On
 * submit we call the existing Supabase auth client's updateUser — no new backend
 * surface, no change to auth logic. If no recovery session is present (expired or
 * reused link) updateUser fails and we route the user back to request a fresh link.
 */
const MIN_LENGTH = 8

export function ResetPasswordForm() {
  const [busy, setBusy] = React.useState(false)
  const [done, setDone] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [expired, setExpired] = React.useState(false)
  const [show, setShow] = React.useState(false)

  React.useEffect(() => {
    const supabase = getBrowserClient()
    // The browser client parses the recovery token from the URL on load and emits
    // PASSWORD_RECOVERY; we don't need to store anything, just let it settle.
    const { data } = supabase.auth.onAuthStateChange(() => {})
    return () => data.subscription.unsubscribe()
  }, [])

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const fd = new FormData(e.currentTarget)
    const password = String(fd.get('password') ?? '')
    const confirm = String(fd.get('confirm') ?? '')

    if (password.length < MIN_LENGTH) {
      setError(`Use at least ${MIN_LENGTH} characters.`)
      return
    }
    if (password !== confirm) {
      setError('Those passwords don’t match.')
      return
    }

    setBusy(true)
    try {
      const supabase = getBrowserClient()
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) {
        // Most common cause: no active recovery session (link expired or already used).
        const msg = updateError.message?.toLowerCase() ?? ''
        if (msg.includes('session') || msg.includes('token') || msg.includes('expired') || msg.includes('auth')) {
          setExpired(true)
        } else if (msg.includes('should be different') || msg.includes('same')) {
          setError('Choose a password you haven’t used before.')
        } else {
          setError('We couldn’t update your password. Please request a new reset link and try again.')
        }
        setBusy(false)
        return
      }
      setDone(true)
    } catch {
      setError('Something went wrong. Please request a new reset link and try again.')
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="space-y-4">
        <div role="status" aria-live="polite" className="rounded-md bg-status-won/10 px-3 py-3 text-sm text-status-won">
          Your password has been updated. You can now sign in with your new password.
        </div>
        <Button asChild className="w-full">
          <Link href="/login">Continue to sign in</Link>
        </Button>
      </div>
    )
  }

  if (expired) {
    return (
      <div className="space-y-4">
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-3 text-sm text-destructive">
          This reset link is invalid or has expired. Reset links can only be used once and are time-limited.
        </p>
        <Button asChild variant="outline" className="w-full">
          <Link href="/forgot-password">Request a new link</Link>
        </Button>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="space-y-1.5">
        <Label htmlFor="password">New password</Label>
        <div className="relative">
          <Input
            id="password"
            name="password"
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
            required
            autoFocus
            className="pr-10"
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
            aria-label={show ? 'Hide password' : 'Show password'}
            aria-pressed={show}
          >
            {show ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
          </button>
        </div>
        <p className="text-xs text-muted-foreground">At least {MIN_LENGTH} characters.</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="confirm">Confirm new password</Label>
        <Input id="confirm" name="confirm" type={show ? 'text' : 'password'} autoComplete="new-password" required />
      </div>
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
        {busy ? 'Updating…' : 'Update password'}
      </Button>
    </form>
  )
}
