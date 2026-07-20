'use client'

import * as React from 'react'
import { Loader2, Check, Search, UserPlus, ScanLine } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { postJson, firstFieldError } from '@/lib/client/api'

export type CheckInStatus = 'registered' | 'attended' | 'no_show' | 'left_early'

export interface CheckInRow {
  reg_id: string
  name: string | null
  email: string | null
  join_token: string | null
  chosen_delivery: string | null
  is_walk_in: boolean | null
  attendance_status: CheckInStatus
}

// Extract a join_token (UUID) from a raw scan — a hardware QR scanner may type the token
// itself or a full check-in URL that contains it. Falls back to the trimmed string.
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
function extractToken(raw: string): string {
  const m = raw.match(UUID_RE)
  return (m ? m[0] : raw).trim()
}

// Retry a POST on transient failure (spotty venue wifi). Deterministic small backoff.
async function retryPost(url: string, body: unknown, attempts = 3): Promise<{ ok: boolean; data?: unknown; error?: unknown }> {
  let last: { ok: boolean; data?: unknown; error?: unknown } = { ok: false }
  for (let n = 1; n <= attempts; n++) {
    last = await postJson(url, body)
    if (last.ok) return last
    await new Promise((r) => setTimeout(r, 250 * n))
  }
  return last
}

// Kiosk check-in (spec §5). Optimistic UI + safe retry; a failed write reverts the tile
// and toasts so nothing is silently lost. Idempotent server means a double-scan is a no-op.
export function WorkshopCheckIn({
  workshopId,
  capacity,
  deliveryMode,
  initialRows,
}: {
  workshopId: string
  capacity: number | null
  deliveryMode: string
  initialRows: CheckInRow[]
}) {
  const [rows, setRows] = React.useState<CheckInRow[]>(initialRows)
  const [query, setQuery] = React.useState('')
  const [scanValue, setScanValue] = React.useState('')
  const [busyId, setBusyId] = React.useState<string | null>(null)
  const [scanBusy, setScanBusy] = React.useState(false)
  const [showWalkIn, setShowWalkIn] = React.useState(false)

  const checkedIn = rows.filter((r) => r.attendance_status === 'attended' || r.attendance_status === 'left_early').length

  const visible = rows.filter((r) => {
    if (!query.trim()) return true
    const q = query.toLowerCase()
    return (r.name ?? '').toLowerCase().includes(q) || (r.email ?? '').toLowerCase().includes(q)
  })

  function setStatus(regId: string, status: CheckInStatus) {
    setRows((prev) => prev.map((r) => (r.reg_id === regId ? { ...r, attendance_status: status } : r)))
  }

  async function checkIn(row: CheckInRow) {
    if (!row.join_token) {
      toast.error('This registrant has no check-in code.')
      return
    }
    if (row.attendance_status === 'attended') return // idempotent no-op locally
    setBusyId(row.reg_id)
    const prev = row.attendance_status
    setStatus(row.reg_id, 'attended') // optimistic
    const res = await retryPost(`/api/workshops/${workshopId}/check-in`, { join_token: row.join_token })
    setBusyId(null)
    if (!res.ok) {
      setStatus(row.reg_id, prev) // revert — no data loss, staff can retry
      toast.error(firstFieldError(res.error as never).message || 'Check-in failed — try again.')
      return
    }
    toast.success(`${row.name ?? 'Attendee'} checked in.`)
  }

  async function checkInByScan(e: React.FormEvent) {
    e.preventDefault()
    const token = extractToken(scanValue)
    if (!token) return
    setScanBusy(true)
    const res = await retryPost(`/api/workshops/${workshopId}/check-in`, { join_token: token })
    setScanBusy(false)
    if (!res.ok) {
      toast.error(firstFieldError(res.error as never).message || 'No match for that code.')
      return
    }
    // Reflect locally if the token belongs to a listed registrant.
    const match = rows.find((r) => r.join_token === token)
    if (match) setStatus(match.reg_id, 'attended')
    const noop = (res.data as { noop?: boolean })?.noop
    toast.success(noop ? 'Already checked in.' : 'Checked in.')
    setScanValue('')
  }

  return (
    <div className="space-y-4">
      {/* Live count. */}
      <Card>
        <CardContent className="flex items-center justify-between p-4">
          <div>
            <div className="mono-label text-xs text-muted-foreground">Checked in</div>
            <div className="numeric text-3xl font-semibold leading-none">
              {checkedIn}
              {capacity ? <span className="text-lg text-muted-foreground"> / {capacity}</span> : null}
            </div>
          </div>
          <Button type="button" variant="outline" onClick={() => setShowWalkIn((s) => !s)} className="h-11">
            <UserPlus className="h-4 w-4" aria-hidden /> Walk-in
          </Button>
        </CardContent>
      </Card>

      {/* Scan / token entry. */}
      <form onSubmit={checkInByScan} className="flex items-center gap-2">
        <div className="relative flex-1">
          <ScanLine className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={scanValue}
            onChange={(e) => setScanValue(e.target.value)}
            placeholder="Scan QR or paste check-in code"
            aria-label="Scan or paste check-in code"
            className="h-11 pl-9"
            inputMode="text"
            autoComplete="off"
          />
        </div>
        <Button type="submit" disabled={scanBusy || !scanValue.trim()} className="h-11">
          {scanBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />} Check in
        </Button>
      </form>

      {showWalkIn ? (
        <WalkInForm
          workshopId={workshopId}
          deliveryMode={deliveryMode}
          onAdded={(row) => {
            setRows((prev) => [row, ...prev])
            setShowWalkIn(false)
          }}
        />
      ) : null}

      {/* Search + roster. */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search attendees by name or email"
          aria-label="Search attendees"
          className="h-11 pl-9"
        />
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">No attendees match “{query}”.</p>
      ) : (
        <ul className="space-y-2">
          {visible.map((r) => {
            const done = r.attendance_status === 'attended' || r.attendance_status === 'left_early'
            const busy = busyId === r.reg_id
            return (
              <li key={r.reg_id}>
                <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 font-medium">
                      <span className="truncate">{r.name ?? 'Attendee'}</span>
                      {r.is_walk_in ? <Badge variant="active">walk-in</Badge> : null}
                    </div>
                    <div className="numeric truncate text-xs text-muted-foreground">{r.email ?? '—'}</div>
                  </div>
                  <Button
                    type="button"
                    size="lg"
                    variant={done ? 'default' : 'outline'}
                    disabled={busy || done}
                    onClick={() => checkIn(r)}
                    className="h-12 min-w-[7rem]"
                    aria-label={done ? `${r.name ?? 'Attendee'} checked in` : `Check in ${r.name ?? 'attendee'}`}
                  >
                    {busy ? (
                      <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                    ) : (
                      <Check className="h-5 w-5" aria-hidden />
                    )}
                    {done ? 'Checked in' : 'Check in'}
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function WalkInForm({
  workshopId,
  deliveryMode,
  onAdded,
}: {
  workshopId: string
  deliveryMode: string
  onAdded: (row: CheckInRow) => void
}) {
  const [name, setName] = React.useState('')
  const [email, setEmail] = React.useState('')
  const [phone, setPhone] = React.useState('')
  const [consentEmail, setConsentEmail] = React.useState(false)
  const [consentSms, setConsentSms] = React.useState(false)
  const [busy, setBusy] = React.useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) {
      toast.error('Name is required.')
      return
    }
    setBusy(true)
    const res = await retryPost(`/api/workshops/${workshopId}/check-in`, {
      walk_in: {
        name: name.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        chosen_delivery: deliveryMode === 'virtual' ? 'virtual' : 'in_person',
        consent_email: consentEmail,
        consent_sms: consentSms,
      },
    })
    setBusy(false)
    if (!res.ok) {
      toast.error(firstFieldError(res.error as never).message || 'Could not add walk-in.')
      return
    }
    const regId = (res.data as { registration_id?: string })?.registration_id ?? crypto.randomUUID()
    toast.success(`${name.trim()} added and checked in.`)
    onAdded({
      reg_id: regId,
      name: name.trim(),
      email: email.trim() || null,
      join_token: null,
      chosen_delivery: deliveryMode === 'virtual' ? 'virtual' : 'in_person',
      is_walk_in: true,
      attendance_status: 'attended',
    })
    setName('')
    setEmail('')
    setPhone('')
    setConsentEmail(false)
    setConsentSms(false)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Add walk-in</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="mono-label text-xs text-muted-foreground">Name</span>
              <Input value={name} onChange={(e) => setName(e.target.value)} required className="h-11" aria-label="Walk-in name" />
            </label>
            <label className="block">
              <span className="mono-label text-xs text-muted-foreground">Email</span>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-11" aria-label="Walk-in email" />
            </label>
            <label className="block">
              <span className="mono-label text-xs text-muted-foreground">Phone</span>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} className="h-11" aria-label="Walk-in phone" />
            </label>
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={consentEmail} onChange={(e) => setConsentEmail(e.target.checked)} className="h-4 w-4" />
              Email consent
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={consentSms} onChange={(e) => setConsentSms(e.target.checked)} className="h-4 w-4" />
              SMS consent (phone required)
            </label>
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={busy} className="h-11">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <UserPlus className="h-4 w-4" aria-hidden />} Add &amp; check in
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
