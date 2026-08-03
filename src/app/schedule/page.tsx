import type { Metadata } from 'next'
import { PublicPage, PublicCard } from '@/components/public/PublicShell'
import { EmptyState } from '@/components/archetypes'
import { load } from '@/lib/data/query'
import type { BookableType } from '@/lib/booking/slots'
import { BookingFlow } from '@/components/public/booking/BookingFlow'
import { ManageFlow } from '@/components/public/booking/ManageFlow'
import { PublicBrandHeader } from '@/components/public/booking/PublicBrandHeader'
import { ScheduleHero } from '@/components/public/booking/ScheduleHero'
import { TypeCard } from '@/components/public/booking/TypeCard'
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
export default async function SchedulePage(props: {
  searchParams: Promise<{ type?: string; manage?: string }>
}) {
  const { type: typeParam, manage } = await props.searchParams

  // Self-service reschedule/cancel (Slice 6) — reached from a signed link in the confirmation
  // email; kept under the allowlisted /schedule path via the `manage` query param.
  if (manage) {
    return (
      <PublicPage>
        <div className="w-full max-w-2xl">
          <PublicBrandHeader />
          <ManageFlow token={manage} />
        </div>
      </PublicPage>
    )
  }

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
          <PublicBrandHeader />
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

  // Distinct meeting formats actually offered — factual input for the hero (no invented data).
  const formats = Array.from(new Set(types.map((t) => t.meeting_mode)))

  return (
    <PublicPage align={types.length ? 'top' : 'center'}>
      <div className="w-full max-w-3xl">
        <PublicBrandHeader />

        {types.length === 0 ? (
          <PublicCard subtitle="Schedule a consultation">
            <EmptyState
              title="Online booking isn't open right now"
              description="We're not taking online appointments at the moment. Please use the contact options on our site and we'll be glad to help."
            />
          </PublicCard>
        ) : (
          <>
            <ScheduleHero formats={formats} />
            <div>
              <h2 className="mono-label mb-3 text-muted-foreground">Choose a meeting</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {types.map((t) => (
                  <TypeCard
                    key={t.id}
                    type={{
                      slug: t.slug,
                      name: t.name,
                      description: t.description,
                      durationMinutes: t.duration_minutes,
                      meetingMode: t.meeting_mode,
                    }}
                  />
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </PublicPage>
  )
}
