'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { deleteJson, firstFieldError } from '@/lib/client/api'

// Slice 7 — FSA Google Calendar (busy-sync) connect card. One-way, READ-ONLY: connecting
// lets the availability engine subtract the FSA's real Google commitments so clients can't
// book over them. FSOS never writes to Google. The OAuth handshake is a full-page redirect
// (start route → Google → callback route → back here), so "Connect" navigates rather than
// POSTs; "Disconnect" clears the stored (encrypted) token.

export interface CalendarConnection {
  id: string
  status: 'not_configured' | 'connected' | 'error' | 'revoked'
  googleAccountEmail: string | null
  calendarId: string
  scopes: string[]
  tokenExpiresAt: string | null
  lastSyncedAt: string | null
  lastError: string | null
  connectedAt: string | null
}

const REASON_TOASTS: Record<string, { kind: 'success' | 'error'; msg: string }> = {
  connected: { kind: 'success', msg: 'Google Calendar connected. Busy times will now block availability.' },
  denied: { kind: 'error', msg: 'Google Calendar connection was cancelled.' },
  invalid_state: { kind: 'error', msg: 'The connection link expired. Please try connecting again.' },
  not_configured: { kind: 'error', msg: 'Google Calendar sync is not configured for this environment.' },
  error: { kind: 'error', msg: 'Could not connect Google Calendar. Please try again.' },
}

function fmt(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export function GoogleCalendarConnect({
  configured,
  connection,
}: {
  configured: boolean
  connection: CalendarConnection | null
}) {
  const router = useRouter()
  const [disconnecting, setDisconnecting] = React.useState(false)

  // Post-redirect feedback (?calendar=<reason>), read from the URL then cleaned up.
  React.useEffect(() => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    const reason = url.searchParams.get('calendar')
    if (!reason) return
    const t = REASON_TOASTS[reason]
    if (t) t.kind === 'success' ? toast.success(t.msg) : toast.error(t.msg)
    url.searchParams.delete('calendar')
    window.history.replaceState({}, '', url.toString())
    if (reason === 'connected') router.refresh()
  }, [router])

  async function disconnect() {
    setDisconnecting(true)
    const res = await deleteJson('/api/app/booking/calendar')
    setDisconnecting(false)
    if (!res.ok) return toast.error(firstFieldError(res.error).message)
    toast.success('Google Calendar disconnected.')
    router.refresh()
  }

  const connect = () => {
    window.location.href = '/api/app/booking/calendar/oauth/start'
  }

  const isConnected = connection?.status === 'connected'
  const isError = connection?.status === 'error'

  if (!configured) {
    return (
      <div className="rounded-lg border border-dashed p-4">
        <div className="flex items-center gap-2">
          <Badge variant="outline">Not configured</Badge>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Google Calendar sync is not set up for this environment. An administrator must add the Google OAuth client
          credentials (<code className="font-mono text-xs">GOOGLE_CALENDAR_CLIENT_ID</code> and{' '}
          <code className="font-mono text-xs">GOOGLE_CALENDAR_CLIENT_SECRET</code>) before it can be connected. Until
          then, availability is calculated from your FSOS hours, appointments, and blackouts only.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {isConnected ? (
            <Badge variant="active">Connected</Badge>
          ) : isError ? (
            <Badge variant="blocked">Needs attention</Badge>
          ) : (
            <Badge variant="outline">Not connected</Badge>
          )}
          {isConnected && connection?.googleAccountEmail ? (
            <span className="text-sm font-medium text-foreground">{connection.googleAccountEmail}</span>
          ) : null}
        </div>
        {isConnected ? (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={connect}>
              Reconnect
            </Button>
            <Button variant="ghost" size="sm" loading={disconnecting} onClick={disconnect}>
              Disconnect
            </Button>
          </div>
        ) : (
          <Button onClick={connect}>Connect Google Calendar</Button>
        )}
      </div>

      <p className="mt-3 text-sm text-muted-foreground">
        Read-only, one-way sync. FSOS reads only your <span className="font-medium">busy time ranges</span> (never event
        titles or details) so clients can’t book over your existing commitments. FSOS never adds or changes anything on
        your Google Calendar.
      </p>

      {isConnected ? (
        <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <div className="flex justify-between gap-4 sm:block">
            <dt className="text-muted-foreground">Last synced</dt>
            <dd className="font-medium">{fmt(connection?.lastSyncedAt ?? null)}</dd>
          </div>
          <div className="flex justify-between gap-4 sm:block">
            <dt className="text-muted-foreground">Connected</dt>
            <dd className="font-medium">{fmt(connection?.connectedAt ?? null)}</dd>
          </div>
        </dl>
      ) : null}

      {isError ? (
        <p className="mt-3 text-sm text-destructive">
          The connection needs to be refreshed — please reconnect to keep blocking busy times.
        </p>
      ) : null}
    </div>
  )
}
