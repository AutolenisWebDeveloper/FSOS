'use client'

import * as React from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getBrowserClient } from '@/lib/supabase/browser'

/**
 * Password-reset request. Uses the existing cookie-backed Supabase auth client —
 * no new backend surface (same call as the in-app AccountActions reset). The
 * recovery email is sent by Supabase; its link lands on /reset-password/continue
 * where the user sets a new password.
 *
 * The confirmation is intentionally generic (it never reveals whether an account
 * exists for the address) to avoid account enumeration.
 */
export function ForgotPasswordForm() {
  const [busy, setBusy] = React.useState(false)
  const [sent, setSent] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const statusRef = React.useRef<HTMLDivElement | null>(null)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const fd = new FormData(e.currentTarget)
    const email = String(fd.get('email') ?? '').trim()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setError('Enter a valid email address.')
      return
    }

    setBusy(true)
    try {
      const supabase = getBrowserClient()
      const redirectTo =
        typeof window !== 'undefined' ? `${window.location.origin}/reset-password/continue` : undefined
      // Supabase does not error for unknown addresses, which preserves the
      // no-enumeration guarantee; we surface the same confirmation either way.
      await supabase.auth.resetPasswordForEmail(email, { redirectTo })
      setSent(true)
      window.setTimeout(() => statusRef.current?.focus(), 40)
    } catch {
      setError('We couldn’t send the reset link just now. Please try again in a moment.')
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <div
        ref={statusRef}
        tabIndex={-1}
        role="status"
        aria-live="polite"
        className="rounded-md bg-status-won/10 px-3 py-3 text-sm text-status-won"
      >
        If an account exists for that address, we’ve sent a password reset link. Check your inbox — and your spam folder
        — then follow the link to choose a new password.
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
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
      </div>
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
        {busy ? 'Sending…' : 'Send reset link'}
      </Button>
    </form>
  )
}
