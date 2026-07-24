import Link from 'next/link'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { requireRole } from '@/lib/auth/session'
import { load } from '@/lib/data/query'
import { ListShell, Section, ErrorState } from '@/components/archetypes'
import { PLATFORM_LABELS } from '@/lib/social/labels'
import type { SocialPlatform } from '@/lib/social/adapters'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface Row {
  id: string
  scheduled_at: string
  status: string
  social_channels?: { platform: SocialPlatform } | null
}

function parseMonth(param: string | undefined): { year: number; month: number } {
  const now = new Date()
  if (param && /^\d{4}-\d{2}$/.test(param)) {
    const [y, m] = param.split('-').map(Number)
    if (m >= 1 && m <= 12) return { year: y, month: m - 1 }
  }
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() }
}

function ym(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}`
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default async function SocialCalendarPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await requireRole('fsa', '/app/social/calendar')
  const sp = await searchParams
  const { year, month } = parseMonth(sp.month)

  const start = new Date(Date.UTC(year, month, 1))
  const end = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59))
  const prev = month === 0 ? ym(year - 1, 11) : ym(year, month - 1)
  const next = month === 11 ? ym(year + 1, 0) : ym(year, month + 1)
  const monthLabel = start.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })

  const res = await load<Row[]>(
    (db) =>
      db
        .from('social_schedule_entries')
        .select('id, scheduled_at, status, social_channels(platform)')
        .gte('scheduled_at', start.toISOString())
        .lte('scheduled_at', end.toISOString())
        .not('status', 'in', '(cancelled)')
        .is('deleted_at', null)
        .order('scheduled_at', { ascending: true }),
    [],
  )

  const breadcrumb = [{ label: 'FSA', href: '/app' }, { label: 'Social', href: '/app/social' }, { label: 'Calendar' }]

  if (!res.ok) {
    return (
      <ListShell title="Content calendar" description="Scheduled social posts by day." breadcrumb={breadcrumb}>
        {res.kind === 'not_configured' ? (
          <div className="rounded-lg border border-shell-border bg-card p-6 text-sm text-muted-foreground">
            Database not configured — set the Supabase environment variables to load the calendar.
          </div>
        ) : (
          <ErrorState description={res.message} />
        )}
      </ListShell>
    )
  }

  // Bucket entries by day-of-month (UTC).
  const byDay = new Map<number, Row[]>()
  for (const r of res.data) {
    const d = new Date(r.scheduled_at).getUTCDate()
    const list = byDay.get(d) ?? []
    list.push(r)
    byDay.set(d, list)
  }

  const firstDow = start.getUTCDay()
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const cells: (number | null)[] = []
  for (let i = 0; i < firstDow; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)

  return (
    <ListShell
      title="Content calendar"
      description="Scheduled social posts by day. Navigate months to plan ahead."
      breadcrumb={breadcrumb}
      actions={
        <div className="flex items-center gap-2">
          <Link href={`/app/social/calendar?month=${prev}`} className="rounded-md border border-shell-border p-1.5 hover:bg-muted/40" aria-label="Previous month">
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </Link>
          <span className="min-w-40 text-center text-sm font-semibold">{monthLabel}</span>
          <Link href={`/app/social/calendar?month=${next}`} className="rounded-md border border-shell-border p-1.5 hover:bg-muted/40" aria-label="Next month">
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      }
    >
      <Section title={monthLabel}>
        <div className="overflow-x-auto">
          <div className="min-w-[42rem]">
            <div className="grid grid-cols-7 gap-px border-b border-shell-border">
              {DOW.map((d) => (
                <div key={d} className="bg-muted/40 p-2 text-center text-xs font-medium text-muted-foreground">
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-px bg-shell-border">
              {cells.map((d, i) => (
                <div key={i} className="min-h-24 bg-card p-1.5">
                  {d ? (
                    <>
                      <div className="numeric mb-1 text-xs text-muted-foreground">{d}</div>
                      <ul className="space-y-1">
                        {(byDay.get(d) ?? []).slice(0, 4).map((e) => (
                          <li
                            key={e.id}
                            className={
                              'truncate rounded px-1 py-0.5 text-[11px] ' +
                              (e.status === 'failed'
                                ? 'bg-status-lost/10 text-status-lost'
                                : e.status === 'published'
                                  ? 'bg-status-won/10 text-status-won'
                                  : 'bg-primary-soft text-primary')
                            }
                            title={`${e.social_channels ? PLATFORM_LABELS[e.social_channels.platform] : 'Account'} · ${new Date(e.scheduled_at).toLocaleTimeString()}`}
                          >
                            {e.social_channels ? PLATFORM_LABELS[e.social_channels.platform] : 'Post'}
                          </li>
                        ))}
                        {(byDay.get(d) ?? []).length > 4 ? (
                          <li className="numeric px-1 text-[11px] text-muted-foreground">
                            +{(byDay.get(d) ?? []).length - 4} more
                          </li>
                        ) : null}
                      </ul>
                    </>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </div>
        <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <CalendarDays className="h-3.5 w-3.5" aria-hidden />
          Times shown in your local timezone. Manage individual posts in the{' '}
          <Link href="/app/social/queue" className="text-primary hover:underline">
            queue
          </Link>
          .
        </p>
      </Section>
    </ListShell>
  )
}
