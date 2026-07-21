import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { CalendarDays, MapPin, Video, Users, GraduationCap, ShieldCheck } from 'lucide-react'
import { SiteShell } from '@/components/public/site/SiteShell'
import { WorkshopRegisterFormSite } from '@/components/public/site/WorkshopRegisterFormSite'
import type { PublicWorkshop } from '@/components/public/WorkshopRegisterForm'
import { loadPublicWorkshop } from '@/lib/workshops/public'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function generateMetadata(props: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await props.params
  const w = await loadPublicWorkshop(slug)
  return { title: w ? `Register — ${w.title}` : 'Register', robots: { index: false, follow: true } }
}

// Public registration page (/workshops/[slug]/register). Event-summary rail + the marketing-
// styled register form. The form posts the identical payload to the existing register route
// with the approved SMS disclosure and separate optional consent — the consent-evidence path
// is unchanged. Published-only.
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

  const when = w.scheduled_at
    ? new Date(w.scheduled_at).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })
    : 'Date to be announced'
  const DeliveryIcon = w.delivery_mode === 'virtual' ? Video : w.delivery_mode === 'hybrid' ? Users : MapPin
  const place =
    w.delivery_mode === 'virtual'
      ? 'Online — join link emailed after you register'
      : w.delivery_mode === 'hybrid'
        ? `${w.venue_address ?? 'In person'} · or online`
        : w.venue_address ?? w.location ?? 'Location shared after you register'

  return (
    <SiteShell active="workshops">
      <main id="main">
        <div className="shell wreg">
          {/* Event summary rail */}
          <aside className="wsummary reveal">
            <span className="wtopic" style={{ background: 'rgba(255,255,255,.12)', borderColor: 'rgba(255,255,255,.2)', color: '#E4ECFA' }}>
              {w.topic}
            </span>
            <h2>{w.title}</h2>
            <ul className="wsummary__meta">
              <li>
                <CalendarDays aria-hidden /> {when}
              </li>
              <li>
                <DeliveryIcon aria-hidden /> {place}
              </li>
              <li>
                <GraduationCap aria-hidden /> Free educational event — nothing is sold
              </li>
              {!w.is_full && w.seats_remaining != null ? (
                <li>
                  <ShieldCheck aria-hidden /> {w.seats_remaining} seats remaining
                </li>
              ) : null}
            </ul>
            <p className="wsummary__note">
              This is an educational event and is not a recommendation to buy, sell, or hold any insurance or investment
              product. Securities offered through Farmers Financial Solutions, LLC · Member FINRA &amp; SIPC.
            </p>
          </aside>

          {/* Registration form */}
          <div className="wformwrap reveal">
            <WorkshopRegisterFormSite workshop={model} />
          </div>
        </div>
      </main>
    </SiteShell>
  )
}
