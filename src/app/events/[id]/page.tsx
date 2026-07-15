import { getDb } from '@/lib/supabase/client'
import { WorkshopRegisterForm, type PublicWorkshop } from '@/components/public/WorkshopRegisterForm'

// Public route — no auth required (on the public allowlist). Restyled to the FSOS
// design language (docs/legacy-port.md §2.5). Loads a published workshop and renders
// the registration form. Consent captured on register; educational content only.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export default async function EventPage({ params }: { params: { id: string } }) {
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
    <main className="min-h-screen bg-slate-100 px-4 py-10">
      <div className="mx-auto w-full max-w-lg">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-700 text-sm font-semibold text-white">
            M
          </div>
          <div className="text-sm font-semibold text-slate-900">Markist Financial Services</div>
        </div>

        {workshop ? (
          <WorkshopRegisterForm workshop={workshop} />
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <h1 className="text-lg font-semibold text-slate-900">Event unavailable</h1>
            <p className="mt-1 text-sm text-slate-600">
              {loadError
                ? 'We could not load this event right now. Please try again later.'
                : 'This event is not open for registration. Please contact your specialist.'}
            </p>
          </div>
        )}

        <p className="mt-6 text-center text-xs text-slate-400">
          © Markist Financial Services · Educational content only.
        </p>
      </div>
    </main>
  )
}
