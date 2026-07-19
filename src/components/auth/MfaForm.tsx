'use client'

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getBrowserClient } from '@/lib/supabase/browser'
import { safeNextPath } from '@/lib/auth/next-path'

// TOTP two-factor (middleware-auth.md §7). Handles BOTH first-time enrollment
// (show a QR to scan, then verify — which activates the factor AND raises the
// session to aal2) and the returning-user challenge (verify only). Super-admin
// step-up reuses the same aal2 outcome.
type Mode = 'loading' | 'enroll' | 'challenge' | 'signedout'

export function MfaForm() {
  const router = useRouter()
  const params = useSearchParams()
  const next = safeNextPath(params.get('next'))
  const supabase = React.useMemo(() => getBrowserClient(), [])

  const [mode, setMode] = React.useState<Mode>('loading')
  const [factorId, setFactorId] = React.useState<string | null>(null)
  const [qr, setQr] = React.useState<string | null>(null)
  const [secret, setSecret] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    async function init() {
      const { data: userData } = await supabase.auth.getUser()
      if (!userData.user) {
        if (!cancelled) setMode('signedout')
        return
      }

      const { data: factors } = await supabase.auth.mfa.listFactors()
      const verified = factors?.totp?.find((f) => f.status === 'verified')
      if (verified) {
        if (!cancelled) {
          setFactorId(verified.id)
          setMode('challenge')
        }
        return
      }

      // No verified factor → clear any stale unverified ones (e.g. an abandoned
      // enroll), then start a fresh enrollment.
      const stale = (factors?.all ?? []).filter((f) => f.status === 'unverified')
      for (const f of stale) await supabase.auth.mfa.unenroll({ factorId: f.id })

      const { data: enrolled, error: enrollErr } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'FSOS Authenticator',
      })
      if (enrollErr || !enrolled) {
        if (!cancelled) setError('Could not start authenticator setup. Reload the page and try again.')
        return
      }
      if (!cancelled) {
        setFactorId(enrolled.id)
        setQr(enrolled.totp.qr_code)
        setSecret(enrolled.totp.secret)
        setMode('enroll')
      }
    }
    init().catch(() => {
      if (!cancelled) setError('Something went wrong. Reload the page and try again.')
    })
    return () => {
      cancelled = true
    }
  }, [supabase])

  React.useEffect(() => {
    if (mode === 'signedout') router.replace(`/login?next=${encodeURIComponent(next)}`)
  }, [mode, next, router])

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    if (!factorId) return
    const fd = new FormData(e.currentTarget)
    const code = String(fd.get('code') ?? '').trim()
    if (!/^\d{6}$/.test(code)) {
      setError('Enter the 6-digit code from your authenticator app.')
      return
    }

    setBusy(true)
    // challengeAndVerify both activates a freshly-enrolled factor and raises the
    // session to aal2 in one step.
    const { error: verifyErr } = await supabase.auth.mfa.challengeAndVerify({ factorId, code })
    if (verifyErr) {
      setBusy(false)
      setError('That code was incorrect or expired. Enter the next code your app shows.')
      return
    }
    router.replace(next)
    router.refresh()
  }

  if (mode === 'loading' || mode === 'signedout') {
    return <p className="text-sm text-muted-foreground">Loading…</p>
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {mode === 'enroll' && qr ? (
        <div className="space-y-2 text-center">
          <p className="text-sm text-muted-foreground">
            Scan this with an authenticator app (Google Authenticator, 1Password, Authy), then enter the 6-digit code it
            shows.
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="Authenticator setup QR code" className="mx-auto h-44 w-44" />
          {secret ? (
            <p className="break-all font-mono text-xs text-muted-foreground">
              Can&apos;t scan? Enter this key manually: {secret}
            </p>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="space-y-1.5">
        <Label htmlFor="code">Authentication code</Label>
        <Input
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          required
        />
      </div>
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? 'Verifying…' : 'Verify'}
      </Button>
    </form>
  )
}
