'use client'

import { useState } from 'react'
import Link from 'next/link'
import { CalendarX2, CheckCircle2 } from 'lucide-react'

// Confirm-step for the registrant self-cancel page (WS-009). The page (server) already
// verified the token and showed what is being cancelled; this component performs the
// POST and swaps to a terminal state. Errors stay recoverable (retry in place).
export function WorkshopCancelConfirm({ token }: { token: string }) {
  const [state, setState] = useState<'idle' | 'submitting' | 'done' | 'error'>('idle')
  const [message, setMessage] = useState<string | null>(null)

  async function cancel() {
    setState('submitting')
    setMessage(null)
    try {
      const res = await fetch('/api/public/workshops/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (res.ok && body.ok) {
        setState('done')
      } else {
        setState('error')
        setMessage(body.error ?? 'Something went wrong. Please try again.')
      }
    } catch {
      setState('error')
      setMessage('Something went wrong. Please check your connection and try again.')
    }
  }

  if (state === 'done') {
    return (
      <div role="status" className="mt-5 rounded-lg border border-status-won/20 bg-status-won/10 p-4">
        <p className="flex items-start gap-2 text-sm font-medium text-foreground">
          <CheckCircle2 aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-status-won" />
          Your registration is cancelled. Your seat has been released — no further reminders
          will be sent for this workshop.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Change of plans again? You can{' '}
          <Link href="/workshops" className="font-medium text-primary underline underline-offset-2">
            register for an upcoming workshop
          </Link>{' '}
          any time.
        </p>
      </div>
    )
  }

  return (
    <div className="mt-5">
      <button
        type="button"
        onClick={cancel}
        disabled={state === 'submitting'}
        className="inline-flex items-center gap-2 rounded-lg bg-destructive px-4 py-2.5 text-sm font-semibold text-destructive-foreground shadow-elev-xs transition-colors hover:bg-destructive/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
      >
        <CalendarX2 aria-hidden className="h-4 w-4" />
        {state === 'submitting' ? 'Cancelling…' : 'Yes, cancel my registration'}
      </button>
      <p className="mt-3 text-xs text-muted-foreground">
        This releases your seat immediately. If you change your mind, you can register again
        while seats remain.
      </p>
      <p aria-live="polite" className="mt-2 min-h-[1.25rem] text-sm font-medium text-destructive">
        {state === 'error' ? message : null}
      </p>
    </div>
  )
}
