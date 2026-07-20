import { getDb } from '@/lib/supabase/client'
import { WorkshopRegisterForm, type PublicWorkshop } from '@/components/public/WorkshopRegisterForm'
import { PublicPage, PublicBrandLockup } from '@/components/public/PublicShell'

// Public route — no auth required (on the public allowlist). Restyled to the FSOS
// design language (docs/legacy-port.md §2.5). Loads a published workshop and renders
// the registration form. Consent captured on register; educational content only.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export default async function EventPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  let workshop: PublicWorkshop | null = null
  let loadError = false

  try {
    const db = getDb()
    const { data: w } = await db
      .from('workshops')
      .select('workshop_id, title, topic, description, scheduled_at, location, max_attendees, status')
      .eq('workshop_id', params.id)
      .maybeSingle()
    if (w && w.status === 'published') {
      const { count } = await db
        .from('workshop_registrations')
        .select('*', { count: 'exact', head: true })
        .eq('workshop_id', params.id)
      const registered = count ?? 0
      workshop = {
        workshop_id: w.workshop_id,
        title: w.title,
        topic: w.topic,
        description: w.description ?? null,
        scheduled_at: w.scheduled_at,
        location: w.location,
        seats_remaining: w.max_attendees ? Math.max(0, w.max_attendees - registered) : null,
        is_full: !!w.max_attendees && registered >= w.max_attendees,
      }
    }
  } catch {
    loadError = true
  }

  return (
    <PublicPage>
      <div className="w-full max-w-lg">
        <PublicBrandLockup />

        {workshop ? (
          <WorkshopRegisterForm workshop={workshop} />
        ) : (
          <div className="rounded-xl border border-border bg-card p-8 text-center shadow-elev-xs">
            <h1 className="text-lg font-semibold text-foreground">Event unavailable</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {loadError
                ? 'We could not load this event right now. Please try again later.'
                : 'This event is not open for registration. Please contact your specialist.'}
            </p>
          </div>
        )}
      </div>
    </PublicPage>
  )
}
