import { CalendarDays } from 'lucide-react'
import { EmptyState, StatusBadge, type StatusKey } from '@/components/archetypes'

export interface AppointmentRow {
  id: string
  household_id: string | null
  review_id: string | null
  scheduled_at: string | null
  status: string
  external_ref: string | null
}

const STATUS_MAP: Record<string, { key: StatusKey; label: string }> = {
  scheduled: { key: 'pending', label: 'scheduled' },
  completed: { key: 'won', label: 'completed' },
  cancelled: { key: 'lost', label: 'cancelled' },
  no_show: { key: 'blocked', label: 'no show' },
}

function dayKey(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

/** Agenda list of upcoming appointments grouped by date (A2-style read surface). */
export function CalendarView({ rows }: { rows: AppointmentRow[] }) {
  const dated = rows.filter((r) => r.scheduled_at)

  if (dated.length === 0) {
    return (
      <EmptyState
        icon={CalendarDays}
        title="No appointments scheduled"
        description="Appointments entered manually or booked from a review will appear here as an agenda."
      />
    )
  }

  const groups = new Map<string, AppointmentRow[]>()
  for (const a of dated) {
    const k = dayKey(a.scheduled_at as string)
    const arr = groups.get(k) ?? []
    arr.push(a)
    groups.set(k, arr)
  }

  return (
    <div className="space-y-5">
      {Array.from(groups.entries()).map(([day, appts]) => (
        <section key={day} className="space-y-2" aria-label={day}>
          <h2 className="text-sm font-semibold">{day}</h2>
          <ul className="divide-y rounded-lg border">
            {appts
              .slice()
              .sort((a, b) => (a.scheduled_at as string).localeCompare(b.scheduled_at as string))
              .map((a) => {
                const s = STATUS_MAP[a.status] ?? { key: 'draft' as StatusKey, label: a.status }
                return (
                  <li key={a.id} className="flex items-center justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <p className="font-medium">{timeOf(a.scheduled_at as string)}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {a.household_id ? 'Household appointment' : 'Appointment'}
                        {a.external_ref ? ` · ${a.external_ref}` : ''}
                      </p>
                    </div>
                    <StatusBadge status={s.key} label={s.label} />
                  </li>
                )
              })}
          </ul>
        </section>
      ))}
    </div>
  )
}
