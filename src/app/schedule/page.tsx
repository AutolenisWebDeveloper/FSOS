import type { Metadata } from 'next'
import Link from 'next/link'
import { PublicPage, PublicBrandLockup, PublicCard } from '@/components/public/PublicShell'
import { EmptyState } from '@/components/archetypes'
import { load } from '@/lib/data/query'
import type { BookableType } from '@/lib/booking/slots'
import { meetingModeLabel } from '@/lib/booking/display'
import { BookingFlow } from '@/components/public/booking/BookingFlow'
import { BUSINESS } from '@/lib/site'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const metadata: Metadata = {
  title: `Book a meeting · ${BUSINESS.short}`,
  description: 'Schedule a consultation with a licensed Financial Services Agent.',
}

// Public booking entry. `?type=<slug>` opens the flow for one appointment type; with no
// type we show the chooser (or open the only type directly). Auth-free — /schedule is on
// the public allowlist and this stays under that exact path (the type is a query param).
export default async function SchedulePage(props: { searchParams: Promise<{ type?: string }> }) {
  const { type: typeParam } = await props.searchParams
  const res = await load<BookableType[]>(
    (db) =>
      db
        .from('appointment_types')
        .select(
          'id, host_user_id, name, slug, description, duration_minutes, buffer_before_minutes, buffer_after_minutes, min_notice_minutes, max_lead_days, max_per_day, slot_interval_minutes, meeting_mode, active',
        )
        .eq('active', true)
        .order('name', { ascending: true }),
    [],
  )
  const types = res.ok ? res.data : []

  const selected = typeParam ? types.find((t) => t.slug === typeParam) : types.length === 1 ? types[0] : undefined

  if (selected) {
    return (
      <PublicPage>
        <div className="w-full max-w-2xl">
          <PublicBrandLockup />
          <BookingFlow
            type={{
              slug: selected.slug,
              name: selected.name,
              description: selected.description,
              durationMinutes: selected.duration_minutes,
              meetingMode: selected.meeting_mode,
            }}
            backHref={types.length > 1 ? '/schedule' : undefined}
          />
        </div>
      </PublicPage>
    )
  }

  return (
    <PublicPage align={types.length ? 'top' : 'center'}>
      <div className="w-full max-w-2xl">
        <PublicBrandLockup />
        <PublicCard subtitle="Schedule a consultation">
          <h1 className="text-lg font-semibold text-foreground">Book a meeting</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose the type of meeting that fits. You&rsquo;ll pick a time in your own timezone next.
          </p>

          {types.length === 0 ? (
            <div className="mt-6">
              <EmptyState
                title="No meeting types available yet"
                description="Online booking isn't open right now. Please use the contact options on our site to reach us."
              />
            </div>
          ) : (
            <ul className="mt-6 space-y-3">
              {types.map((t) => (
                <li key={t.id}>
                  <Link
                    href={`/schedule?type=${encodeURIComponent(t.slug)}`}
                    className="group flex items-center justify-between gap-4 rounded-lg border border-border bg-card px-4 py-3.5 transition-colors hover:border-ring/60 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-foreground">{t.name}</div>
                      {t.description ? (
                        <div className="mt-0.5 truncate text-sm text-muted-foreground">{t.description}</div>
                      ) : null}
                    </div>
                    <div className="shrink-0 text-right text-xs text-muted-foreground">
                      <div>{t.duration_minutes} min</div>
                      <div>{meetingModeLabel(t.meeting_mode)}</div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </PublicCard>
      </div>
    </PublicPage>
  )
}
