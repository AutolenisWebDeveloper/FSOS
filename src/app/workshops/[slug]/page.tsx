import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  CalendarDays,
  MapPin,
  Video,
  Users,
  ArrowRight,
  Check,
  GraduationCap,
  Clock,
  Ticket,
  UserRound,
} from 'lucide-react'
import { SiteShell } from '@/components/public/site/SiteShell'
import { loadPublicWorkshop } from '@/lib/workshops/public'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function generateMetadata(props: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await props.params
  const w = await loadPublicWorkshop(slug)
  if (!w) return { title: 'Workshop' }
  return {
    title: `${w.title} — Educational Workshop`,
    description: w.description ?? 'A free educational financial workshop with Markist Athelus, Financial Services Agent.',
    alternates: { canonical: `/workshops/${w.slug}` },
  }
}

const FORMAT_LABEL: Record<string, string> = { in_person: 'In person', virtual: 'Online', hybrid: 'Hybrid' }

// Public topic landing page (/workshops/[slug]) — the primary conversion surface. Hero,
// agenda, presenters, session logistics, RSVP. PUBLISHED-only (compliance publish gate).
// Full marketing chrome. Educational framing only; no product recommendation, no fabricated
// stats. Scarcity (seats) is real data.
export default async function WorkshopLandingPage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params
  const w = await loadPublicWorkshop(slug)
  if (!w) notFound()

  const when = w.scheduled_at
    ? new Date(w.scheduled_at).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })
    : 'Date to be announced'
  const timeOnly = w.scheduled_at
    ? new Date(w.scheduled_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : null
  const DeliveryIcon = w.delivery_mode === 'virtual' ? Video : w.delivery_mode === 'hybrid' ? Users : MapPin
  const place =
    w.delivery_mode === 'virtual'
      ? 'Online — a private join link is emailed after you register'
      : w.delivery_mode === 'hybrid'
        ? `${w.venue_address ?? 'In person'} · or join online`
        : w.venue_address ?? w.location ?? 'Location shared after you register'
  const agendaItems = (w.agenda ?? '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
  const registerHref = `/workshops/${w.slug}/register`
  const ctaLabel = w.is_full ? 'Join the waitlist' : 'Reserve your seat'

  return (
    <SiteShell active="workshops">
      <main id="main">
        {/* Hero */}
        <section className="whero">
          <div className="shell whero__in">
            <div>
              <span className="wtopic reveal">{w.topic}</span>
              <h1 className="reveal">{w.title}</h1>
              {w.description ? <p className="whero__lead reveal">{w.description}</p> : null}
              <ul className="whero__meta reveal">
                <li>
                  <CalendarDays aria-hidden /> {when}
                </li>
                <li>
                  <DeliveryIcon aria-hidden /> {place}
                </li>
                {w.host_name ? (
                  <li>
                    <UserRound aria-hidden /> Hosted by {w.host_name}
                  </li>
                ) : null}
              </ul>
              <div className="whero__acts reveal">
                <a className="btn btn--red" href={registerHref}>
                  {ctaLabel} <ArrowRight aria-hidden />
                </a>
                <span className="wbadge" style={{ background: 'rgba(255,255,255,.1)', borderColor: 'rgba(255,255,255,.2)', color: '#E4ECFA' }}>
                  <GraduationCap aria-hidden /> Free · education only
                </span>
              </div>
              {!w.is_full && w.seats_remaining != null ? (
                <p className="whero__seats reveal">
                  <strong>{w.seats_remaining} seats</strong> remaining for this session.
                </p>
              ) : w.is_full ? (
                <p className="whero__seats reveal">This session is full — join the waitlist and we&apos;ll hold the next one for you.</p>
              ) : null}
            </div>

            {/* Image slot / session summary (clean branded slot when no photo) */}
            <div className="wart reveal" aria-hidden={!w.hero_url}>
              {w.hero_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={w.hero_url} alt={`${w.title} — educational workshop`} />
              ) : (
                <div className="wart__slot">
                  <GraduationCap aria-hidden />
                  <span>{FORMAT_LABEL[w.delivery_mode] ?? 'In person'} educational workshop</span>
                  {timeOnly ? (
                    <span style={{ color: '#C9D8F0', fontWeight: 600 }}>Starts {timeOnly}</span>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* What you'll learn */}
        {agendaItems.length > 0 ? (
          <section className="wsec">
            <div className="shell">
              <h2 className="reveal">What you&apos;ll walk away with</h2>
              <p className="wsec__sub reveal">Clear, practical takeaways — no jargon, no obligation.</p>
              <ul className="wlearn">
                {agendaItems.map((item, i) => (
                  <li key={i} className="reveal">
                    <Check aria-hidden /> <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        ) : null}

        {/* Presenters */}
        {w.presenters.length > 0 ? (
          <section className="wsec wsec--mist">
            <div className="shell">
              <h2 className="reveal">Who&apos;s presenting</h2>
              <p className="wsec__sub reveal">Licensed professionals — here to educate, not to sell.</p>
              <div className="wpres">
                {w.presenters.map((p, i) => {
                  const org = [p.firm, p.fund_family].filter(Boolean).join(' · ')
                  return (
                    <div key={i} className="wpres__card reveal">
                      {p.headshot_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img className="wpres__ph" src={p.headshot_url} alt={p.name} />
                      ) : (
                        <span className="wpres__ph wpres__ph--slot" aria-hidden>
                          {p.name.slice(0, 1)}
                        </span>
                      )}
                      <div>
                        <h3>{p.name}</h3>
                        {p.title || org ? <p className="wpres__role">{[p.title, org].filter(Boolean).join(' · ')}</p> : null}
                        {p.bio ? <p className="wpres__bio">{p.bio}</p> : null}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </section>
        ) : null}

        {/* Session logistics */}
        <section className="wsec">
          <div className="shell">
            <h2 className="reveal">Session details</h2>
            <div className="wlog" style={{ marginTop: 20 }}>
              <div className="wlog__item reveal">
                <CalendarDays aria-hidden />
                <strong>When</strong>
                <span>{when}</span>
              </div>
              <div className="wlog__item reveal">
                <DeliveryIcon aria-hidden />
                <strong>{FORMAT_LABEL[w.delivery_mode] ?? 'In person'}</strong>
                <span>{place}</span>
              </div>
              <div className="wlog__item reveal">
                <Ticket aria-hidden />
                <strong>Reserve</strong>
                <span>
                  {w.is_full
                    ? 'This session is full — join the waitlist.'
                    : w.seats_remaining != null
                      ? `${w.seats_remaining} seats remaining. Free to attend.`
                      : 'Free to attend — reserve your seat.'}
                </span>
              </div>
              <div className="wlog__item reveal">
                <Clock aria-hidden />
                <strong>Time commitment</strong>
                <span>Roughly an hour, with time for your questions.</span>
              </div>
            </div>

            <div className="whero__acts" style={{ marginTop: 28 }}>
              <a className="btn btn--red" href={registerHref}>
                {ctaLabel} <ArrowRight aria-hidden />
              </a>
              <Link className="btn btn--ghostnavy" href="/workshops">
                Browse all workshops
              </Link>
            </div>

            <p className="wdisc">
              This is an educational event. It is informational only and is not a recommendation to buy, sell, or hold
              any insurance or investment product, and is not investment, tax, or legal advice. Securities offered
              through Farmers Financial Solutions, LLC · Member FINRA &amp; SIPC.
            </p>
          </div>
        </section>

        {/* Sticky mobile CTA */}
        <div className="wsticky">
          <span className="wsticky__l">
            <strong>{w.title}</strong>
            <span>{timeOnly ? `Starts ${timeOnly}` : 'Reserve your seat'}</span>
          </span>
          <a className="btn btn--red" href={registerHref}>
            {w.is_full ? 'Waitlist' : 'Reserve'} <ArrowRight aria-hidden />
          </a>
        </div>
      </main>
    </SiteShell>
  )
}
