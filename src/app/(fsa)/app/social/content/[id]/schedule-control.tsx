'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { CalendarClock, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface ChannelOption {
  id: string
  label: string
  connected: boolean
}

// Schedule an APPROVED version to a connected account. Only an APPROVED version can
// be scheduled (enforced by the service + DB gate); this control is only rendered
// for approved/scheduled content.
export function ScheduleControl({ versionId, channels }: { versionId: string; channels: ChannelOption[] }) {
  const router = useRouter()
  const [channelId, setChannelId] = useState(channels[0]?.id ?? '')
  const [when, setWhen] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState(false)
  const [pending, startTransition] = useTransition()

  function submit() {
    setError(null)
    setWarnings([])
    setOk(false)
    if (!channelId) {
      setError('Choose an account.')
      return
    }
    if (!when) {
      setError('Choose a date and time.')
      return
    }
    startTransition(async () => {
      const resp = await fetch('/api/social/schedule', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ version_id: versionId, channel_id: channelId, scheduled_at: new Date(when).toISOString() }),
      })
      const body = await resp.json().catch(() => ({}))
      if (!resp.ok) {
        setError(body.error || 'Could not schedule.')
        return
      }
      setOk(true)
      setWarnings(Array.isArray(body.warnings) ? body.warnings : [])
      router.refresh()
    })
  }

  return (
    <div className="rounded-lg border border-shell-border bg-card p-4">
      <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
        <CalendarClock className="h-4 w-4 text-primary" aria-hidden />
        Schedule this approved post
      </p>

      {channels.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No accounts registered yet. Connect an account under{' '}
          <Link href="/app/social/accounts" className="text-primary hover:underline">
            Social Accounts
          </Link>{' '}
          first.
        </p>
      ) : (
        <div className="space-y-3">
          <div>
            <Label htmlFor="sched-channel">Account</Label>
            <select
              id="sched-channel"
              className="mt-1 w-full rounded-md border border-shell-border bg-background px-3 py-2 text-sm"
              value={channelId}
              onChange={(e) => setChannelId(e.target.value)}
            >
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                  {c.connected ? '' : ' (not connected)'}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="sched-when">Publish at</Label>
            <Input id="sched-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="mt-1" />
          </div>
          {error ? (
            <p className="text-sm text-status-lost" role="alert">
              {error}
            </p>
          ) : null}
          {ok ? <p className="text-sm text-status-won">Scheduled. It appears in the queue and calendar.</p> : null}
          {warnings.length > 0 ? (
            <ul className="rounded-md border border-status-assumption/40 bg-status-assumption/10 p-2 text-xs text-status-assumption">
              {warnings.map((w, i) => (
                <li key={i}>⚠ {w}</li>
              ))}
            </ul>
          ) : null}
          <Button size="sm" onClick={submit} disabled={pending}>
            {pending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : null}
            Add to queue
          </Button>
        </div>
      )}
    </div>
  )
}
