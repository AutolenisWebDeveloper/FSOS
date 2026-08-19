// src/components/public/booking/ReviewSummary.tsx
// Read-back-before-submit step for the public booking flow (P1). Presentational: it shows the
// booker exactly what will be submitted and gives per-section "Edit" affordances that jump back
// to the slot or details step, plus a single guarded "Confirm booking" action. It performs NO
// submission itself — the flow owns the POST (and duplicate-submit protection via `submitting`).
'use client'

import { Button } from '@/components/ui/button'
import { PublicCard, PublicAlert } from '@/components/public/PublicShell'
import { meetingModeLabel } from '@/lib/booking/display'
import { appointmentReasonLabel } from '@/lib/booking/config-schemas'

/** Full date + time in the booker's chosen zone. */
function fullWhen(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso))
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 py-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium text-foreground">{value}</dd>
    </div>
  )
}

function SectionHeader({ title, onEdit, editLabel }: { title: string; onEdit: () => void; editLabel: string }) {
  return (
    <div className="mb-1 flex items-center justify-between">
      <h2 className="mono-label text-muted-foreground">{title}</h2>
      <Button type="button" variant="link" size="sm" className="h-auto px-0" onClick={onEdit}>
        {editLabel}
      </Button>
    </div>
  )
}

export interface ReviewSummaryProps {
  typeName: string
  startsAt: string
  timezone: string
  durationMinutes: number
  meetingMode: string
  name: string
  email: string
  phone?: string | null
  /** Stored reason slug (APPOINTMENT_REASONS); rendered as its human label. */
  reason?: string | null
  onEdit: (step: 'slot' | 'details') => void
  onConfirm: () => void
  submitting: boolean
  /** Safe, plain-language error surfaced after a failed confirm attempt (retryable). */
  error?: string | null
}

export function ReviewSummary({
  typeName,
  startsAt,
  timezone,
  durationMinutes,
  meetingMode,
  name,
  email,
  phone,
  reason,
  onEdit,
  onConfirm,
  submitting,
  error,
}: ReviewSummaryProps) {
  return (
    <PublicCard subtitle="Review & confirm" className="max-w-2xl">
      <h1 className="text-lg font-semibold text-foreground">Review your booking</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Please check the details below, then confirm. You can edit anything before you book.
      </p>

      <div className="mt-5 space-y-5">
        <section>
          <SectionHeader title="Appointment" onEdit={() => onEdit('slot')} editLabel="Edit time" />
          <dl className="divide-y divide-border rounded-lg border border-border bg-accent/30 px-4 py-1 text-sm">
            <Row label="Meeting" value={typeName} />
            <Row label="When" value={fullWhen(startsAt, timezone)} />
            <Row label="Timezone" value={timezone} />
            <Row label="Duration" value={`${durationMinutes} min`} />
            <Row label="Format" value={meetingModeLabel(meetingMode)} />
          </dl>
        </section>

        <section>
          <SectionHeader title="Your details" onEdit={() => onEdit('details')} editLabel="Edit details" />
          <dl className="divide-y divide-border rounded-lg border border-border bg-accent/30 px-4 py-1 text-sm">
            <Row label="Name" value={name} />
            <Row label="Email" value={email} />
            {phone ? <Row label="Phone" value={phone} /> : null}
            {appointmentReasonLabel(reason) ? <Row label="Reason" value={appointmentReasonLabel(reason)!} /> : null}
          </dl>
        </section>
      </div>

      {error ? (
        <PublicAlert className="mt-5">{error}</PublicAlert>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <Button type="button" onClick={onConfirm} loading={submitting}>
          {submitting ? 'Booking…' : 'Confirm booking'}
        </Button>
        <Button type="button" variant="outline" onClick={() => onEdit('details')} disabled={submitting}>
          Back
        </Button>
      </div>
    </PublicCard>
  )
}
