'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, CalendarClock, Save, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { patchJson, firstFieldError } from '@/lib/client/api'
import { isValidIanaZone } from '@/lib/booking/config-schemas'

export interface WorkshopEditable {
  workshop_id: string
  status: string
  title: string
  description: string | null
  agenda: string | null
  host_name: string | null
  location: string | null
  budget_spend: number | null
  budget_spend_note: string | null
  /** The upcoming session's current values (null when there is no scheduled session). */
  session: {
    id: string
    starts_at: string
    ends_at: string | null
    timezone: string | null
    venue_name: string | null
    venue_address: string | null
  } | null
}

/** A session's zone is usable only when it is present AND a real IANA zone. Anything
 *  else is unresolved — never substituted with a default. */
function zoneResolved(timeZone: string | null): boolean {
  return !!timeZone && isValidIanaZone(timeZone)
}

/** `datetime-local` wants YYYY-MM-DDTHH:mm in the VENUE's zone — the operator edits the
 *  time they actually booked, not their own local time. */
function toLocalInput(iso: string | null, timeZone: string | null): string {
  if (!iso) return ''
  // FAIL CLOSED. A guessed zone renders a time that is silently wrong by hours, and the
  // operator has no way to see it — the same defect class as WS-005. No zone, no value;
  // the panel disables the field and says why.
  if (!zoneResolved(timeZone)) return ''
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone as string,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date(iso))
    const g = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
    const hour = g('hour') === '24' ? '00' : g('hour')
    return `${g('year')}-${g('month')}-${g('day')}T${hour}:${g('minute')}`
  } catch {
    return ''
  }
}

/** Convert a venue-local `datetime-local` value back to a UTC instant. */
function toUtcIso(local: string, timeZone: string | null): string | null {
  if (!local) return null
  // FAIL CLOSED, as above: writing a start instant derived from a guessed zone would
  // reschedule the workshop to the wrong moment and notify every registrant of it.
  if (!zoneResolved(timeZone)) return null
  const zone = timeZone as string
  const naive = Date.parse(`${local}:00Z`)
  if (Number.isNaN(naive)) return null
  // Resolve the zone's offset AT that wall-clock moment (DST-correct within an hour of
  // a transition, which is not a scheduling case that occurs in practice).
  const probe = new Date(naive)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(probe)
  const m: Record<string, number> = {}
  for (const p of parts) if (p.type !== 'literal') m[p.type] = Number(p.value)
  const asUtc = Date.UTC(m.year, (m.month ?? 1) - 1, m.day, m.hour === 24 ? 0 : m.hour, m.minute, m.second)
  const offsetMs = asUtc - naive
  return new Date(naive - offsetMs).toISOString()
}

/**
 * WS-046 — edit a workshop in place on its detail page, wired to the PATCH route Batch 4
 * extended. Covers the fields cost-per-lead reporting needs (`budget_spend`) and the
 * WS-007 reschedule/venue path.
 *
 * Two guardrails are surfaced, not hidden:
 *   • A time or venue change is MATERIAL — it re-arms the reminder cadence and queues a
 *     change notice to everyone already registered. The panel says so before you save.
 *   • Saving details on an approved/published workshop is fine, but the route
 *     invalidates a standing approval on PRESENTER/MATERIAL edits (WS-047); this panel
 *     edits neither, so it never silently takes a workshop off the air.
 */
export function WorkshopEditPanel({ workshop }: { workshop: WorkshopEditable }) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [errorField, setErrorField] = React.useState<string | undefined>()

  const tz = workshop.session?.timezone ?? null
  // Unresolved zone → the schedule fields refuse rather than guess (see zoneResolved).
  const tzUsable = zoneResolved(tz)
  const scheduleLocked = !!workshop.session && !tzUsable
  const [title, setTitle] = React.useState(workshop.title)
  const [description, setDescription] = React.useState(workshop.description ?? '')
  const [agenda, setAgenda] = React.useState(workshop.agenda ?? '')
  const [hostName, setHostName] = React.useState(workshop.host_name ?? '')
  const [budget, setBudget] = React.useState(workshop.budget_spend != null ? String(workshop.budget_spend) : '')
  const [budgetNote, setBudgetNote] = React.useState(workshop.budget_spend_note ?? '')
  const [startsAt, setStartsAt] = React.useState(toLocalInput(workshop.session?.starts_at ?? null, tz))
  const [venueName, setVenueName] = React.useState(workshop.session?.venue_name ?? '')
  const [venueAddress, setVenueAddress] = React.useState(workshop.session?.venue_address ?? '')

  const originalStart = toLocalInput(workshop.session?.starts_at ?? null, tz)
  const timeChanged = !!workshop.session && !scheduleLocked && startsAt !== '' && startsAt !== originalStart
  const venueChanged =
    !!workshop.session &&
    (venueName !== (workshop.session.venue_name ?? '') || venueAddress !== (workshop.session.venue_address ?? ''))
  const material = timeChanged || venueChanged

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setBusy(true)
    setErrorField(undefined)

    const payload: Record<string, unknown> = {}
    if (title !== workshop.title) payload.title = title
    if (description !== (workshop.description ?? '')) payload.description = description
    if (agenda !== (workshop.agenda ?? '')) payload.agenda = agenda
    if (hostName !== (workshop.host_name ?? '')) payload.host_name = hostName
    if (budget !== (workshop.budget_spend != null ? String(workshop.budget_spend) : '')) {
      payload.budget_spend = budget === '' ? 0 : Number(budget)
    }
    if (budgetNote !== (workshop.budget_spend_note ?? '')) payload.budget_spend_note = budgetNote
    if (workshop.session) {
      // The lock is on the TIME, not on the form. Title, description, agenda, host,
      // budget and venue do not depend on the session's zone, so an unresolved zone must
      // not discard them — and must never report a time change the operator did not make.
      // Belt and braces: timeChanged is already false while locked, so this fires only if
      // a time edit reaches here some other way.
      if (scheduleLocked && startsAt !== '' && startsAt !== originalStart) {
        setBusy(false)
        setErrorField('starts_at')
        toast.error('Set this session\u2019s timezone before changing its time.')
        return
      }
      if (timeChanged) {
        const iso = toUtcIso(startsAt, tz)
        if (!iso) {
          setBusy(false)
          setErrorField('starts_at')
          toast.error('That date and time could not be read.')
          return
        }
        payload.session_id = workshop.session.id
        payload.starts_at = iso
      }
      if (venueChanged) {
        payload.session_id = workshop.session.id
        payload.venue_name = venueName || null
        payload.venue_address = venueAddress || null
      }
    }

    if (Object.keys(payload).length === 0) {
      setBusy(false)
      toast.message('Nothing changed.')
      return
    }

    const res = await patchJson<{ session_change?: { kind: string | null } }>(`/api/workshops/${workshop.workshop_id}`, payload)
    setBusy(false)
    if (!res.ok) {
      const fe = firstFieldError(res.error)
      setErrorField(fe.field)
      toast.error(fe.message)
      return
    }
    const kind = res.data?.session_change?.kind
    toast.success(
      kind === 'change_reschedule'
        ? 'Saved. Registrants will be notified of the new time.'
        : kind === 'change_venue'
          ? 'Saved. Registrants will be notified of the new location.'
          : 'Workshop updated.',
    )
    setOpen(false)
    router.refresh()
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Save className="h-4 w-4" aria-hidden /> Edit details
      </Button>
    )
  }

  return (
    <form onSubmit={onSubmit} className="w-full space-y-5 rounded-lg border border-border bg-card p-4 sm:p-5">
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="e_title">Title</Label>
          <Input id="e_title" value={title} onChange={(e) => setTitle(e.target.value)} required aria-invalid={errorField === 'title'} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="e_host">Host / presenter of record</Label>
          <Input id="e_host" value={hostName} onChange={(e) => setHostName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="e_desc">Description</Label>
          <Textarea id="e_desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="e_agenda">Agenda</Label>
          <Textarea id="e_agenda" rows={3} value={agenda} onChange={(e) => setAgenda(e.target.value)} />
        </div>
      </div>

      {/* ── Event spend — the cost-per-lead input (assumption-badged planning figure) ── */}
      <section className="space-y-4 border-t pt-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="e_budget">Event spend (USD)</Label>
            <Input
              id="e_budget"
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              aria-describedby="e_budget_help"
              aria-invalid={errorField === 'budget_spend'}
            />
            <p id="e_budget_help" className="text-xs text-muted-foreground">
              Your own planning figure — drives cost per lead on the report. Never a published Farmers number.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="e_budget_note">Spend note</Label>
            <Input id="e_budget_note" value={budgetNote} onChange={(e) => setBudgetNote(e.target.value)} placeholder="Venue + catering" />
          </div>
        </div>
      </section>

      {/* ── Schedule + venue (WS-007) ── */}
      {workshop.session ? (
        <section className="space-y-4 border-t pt-4">
          <div className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-muted-foreground" aria-hidden />
            <h3 className="text-sm font-medium text-foreground">Schedule &amp; location</h3>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="e_start">Date &amp; time</Label>
              <Input
                id="e_start"
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                disabled={scheduleLocked}
                aria-describedby="e_start_help"
                aria-invalid={errorField === 'starts_at'}
              />
              <p
                id="e_start_help"
                className={`text-xs ${scheduleLocked ? 'text-status-pending' : 'text-muted-foreground'}`}
              >
                {scheduleLocked
                  ? `This session has no usable timezone${tz ? ` (${tz} is not a valid IANA zone)` : ''}, so its start time cannot be shown or changed here \u2014 a guessed zone would move the workshop by hours and notify every registrant of the wrong time. Set the session timezone first.`
                  : `In the venue\u2019s timezone (${tz}).`}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="e_venue">Venue name</Label>
              <Input id="e_venue" value={venueName} onChange={(e) => setVenueName(e.target.value)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="e_addr">Venue address</Label>
              <Input id="e_addr" value={venueAddress} onChange={(e) => setVenueAddress(e.target.value)} />
            </div>
          </div>

          {material ? (
            <div role="status" className="flex items-start gap-2 rounded-md border border-status-pending/30 bg-status-pending/10 px-3 py-2 text-sm text-status-pending">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
                {timeChanged
                  ? 'Changing the time notifies everyone already registered and re-arms their reminders.'
                  : 'Changing the location notifies everyone already registered.'}
              </span>
            </div>
          ) : null}
        </section>
      ) : (
        <p className="border-t pt-4 text-sm text-muted-foreground">
          This workshop has no upcoming session to reschedule.
        </p>
      )}

      <div className="flex items-center gap-2 border-t pt-4">
        <Button type="submit" disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
          Save changes
        </Button>
        <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
