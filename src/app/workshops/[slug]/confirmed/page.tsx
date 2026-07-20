import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { CheckCircle2, CalendarDays, MapPin, Video, Users, Mail, ArrowRight, GraduationCap } from 'lucide-react'
import { SiteShell } from '@/components/public/site/SiteShell'
import { loadPublicWorkshop } from '@/lib/workshops/public'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const metadata: Metadata = { title: 'You’re registered — Workshop', robots: { index: false, follow: true } }

// Confirmation page (/workshops/[slug]/confirmed). Reached after a successful registration.
// Premium marketing chrome; educational framing. No dead ends — always offers a next action.
export default async function WorkshopConfirmedPage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params
  const w = await loadPublicWorkshop(slug)
  if (!w) notFound()

  const when = w.scheduled_at
    ? new Date(w.scheduled_at).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })
    : 'Date to be announced'
  const DeliveryIcon = w.delivery_mode === 'virtual' ? Video : w.delivery_mode === 'hybrid' ? Users : MapPin
  const place =
    w.delivery_mode === 'virtual'
      ? 'Online — your private join link arrives by email before the event'
      : w.delivery_mode === 'hybrid'
        ? `${w.venue_address ?? 'In person'} · or join online`
        : w.venue_address ?? w.location ?? 'Location details to follow by email'

  return (
    <SiteShell>
      <main id="main">
        <div className="shell wconfirm">
          <div className="wconfirm__badge reveal">
            <CheckCircle2 aria-hidden />
          </div>
          <h1 className="reveal">You&apos;re registered!</h1>
          <p className="wconfirm__lead reveal">
            Your seat for <strong>{w.title}</strong> is reserved. A confirmation is on its way to your inbox.
          </p>

          <div className="wnext reveal">
            <h2>Your session</h2>
            <ul>
              <li>
                <CalendarDays aria-hidden /> <span>{when}</span>
              </li>
              <li>
                <DeliveryIcon aria-hidden /> <span>{place}</span>
              </li>
            </ul>
          </div>

          <div className="wnext reveal">
            <h2>What happens next</h2>
            <ul>
              <li>
                <Mail aria-hidden /> <span>We&apos;ll email your confirmation and a reminder before the event.</span>
              </li>
              {w.delivery_mode !== 'in_person' ? (
                <li>
                  <Video aria-hidden /> <span>Your unique join link arrives ahead of the session — it&apos;s yours only, please don&apos;t share it.</span>
                </li>
              ) : null}
              <li>
                <GraduationCap aria-hidden /> <span>Come with questions — there&apos;s always time for them. Nothing is sold, and there&apos;s no obligation.</span>
              </li>
            </ul>
          </div>

          <div className="whero__acts" style={{ justifyContent: 'center', marginTop: 30 }}>
            <a className="btn btn--red" href="/workshops">
              Browse more workshops <ArrowRight aria-hidden />
            </a>
            <a className="btn btn--ghostnavy" href="/">
              Back to home
            </a>
          </div>
        </div>
      </main>
    </SiteShell>
  )
}
