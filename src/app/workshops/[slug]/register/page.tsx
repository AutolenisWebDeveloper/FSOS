import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { PublicPage, PublicBrandLockup } from '@/components/public/PublicShell'
import { WorkshopRegisterForm, type PublicWorkshop } from '@/components/public/WorkshopRegisterForm'
import { loadPublicWorkshop } from '@/lib/workshops/public'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function generateMetadata(props: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await props.params
  const w = await loadPublicWorkshop(slug)
  return { title: w ? `Register — ${w.title}` : 'Register' }
}

// Public registration page (/workshops/[slug]/register). Renders the hardened register
// form with delivery choice + APPROVED SMS disclosure (never placeholder). Published-only.
export default async function WorkshopRegisterPage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params
  const w = await loadPublicWorkshop(slug)
  if (!w) notFound()

  const model: PublicWorkshop = {
    workshop_id: w.workshop_id,
    title: w.title,
    topic: w.topic,
    description: w.description,
    scheduled_at: w.scheduled_at,
    location: w.venue_address ?? w.location,
    seats_remaining: w.seats_remaining,
    is_full: w.is_full,
    slug: w.slug,
    delivery_mode: w.delivery_mode,
    session_id: w.session_id,
    sms_disclosure: w.sms_disclosure,
    confirm_url: `/workshops/${w.slug}/confirmed`,
  }

  return (
    <PublicPage>
      <div className="w-full max-w-lg">
        <PublicBrandLockup />
        <WorkshopRegisterForm workshop={model} />
      </div>
    </PublicPage>
  )
}
