import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { CalendarDays, MapPin, Video, Users, ArrowRight } from 'lucide-react'
import { PublicPage } from '@/components/public/PublicShell'
import { loadPublicWorkshop } from '@/lib/workshops/public'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function generateMetadata(props: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await props.params
  const w = await loadPublicWorkshop(slug)
  return { title: w ? `${w.title} — Workshop` : 'Workshop' }
}

// Public topic landing page (/workshops/[slug]). Hero, agenda, presenters, session, RSVP.
// Published-only. Extends the public shell; educational framing only.
export default async function WorkshopLandingPage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params
  const w = await loadPublicWorkshop(slug)
  if (!w) notFound()

  const when = w.scheduled_at
    ? new Date(w.scheduled_at).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })
    : 'Date to be announced'
  const DeliveryIcon = w.delivery_mode === 'virtual' ? Video : w.delivery_mode === 'hybrid' ? Users : MapPin
  const place =
    w.delivery_mode === 'virtual'
      ? 'Online (join link provided after you register)'
      : w.delivery_mode === 'hybrid'
        ? `${w.venue_address ?? 'In person'} · or join online`
        : w.venue_address ?? w.location ?? 'Location to follow'
  const agendaItems = (w.agenda ?? '').split('\n').map((s) => s.trim()).filter(Boolean)

  return (
    <PublicPage>
      <article className="w-full max-w-2xl">
        {/* Hero */}
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-elev-sm">
          {w.hero_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={w.hero_url} alt={`${w.title} workshop`} className="h-44 w-full object-cover sm:h-56" />
          ) : (
            <div className="shell-gradient h-28 w-full" aria-hidden />
          )}
          <div className="p-6 sm:p-8">
            <span className="inline-flex items-center rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-medium capitalize text-primary">
              {w.topic}
            </span>
            <h1 className="mt-3 text-2xl font-bold tracking-tight text-foreground text-balance sm:text-3xl">{w.title}</h1>
            {w.description ? <p className="mt-2 text-sm text-muted-foreground">{w.description}</p> : null}
            <dl className="mt-4 space-y-1.5 text-sm text-foreground/80">
              <div className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-muted-foreground" aria-hidden /> {when}
              </div>
              <div className="flex items-center gap-2">
                <DeliveryIcon className="h-4 w-4 text-muted-foreground" aria-hidden /> {place}
              </div>
              {w.host_name ? <div className="text-muted-foreground">Hosted by {w.host_name}</div> : null}
            </dl>
            <Link
              href={`/workshops/${w.slug}/register`}
              className="mt-6 inline-flex items-center justify-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-elev-xs transition-colors hover:bg-primary-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {w.is_full ? 'Join the waitlist' : 'Reserve your seat'}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
            {w.seats_remaining != null ? (
              <p className="mt-2 text-xs text-muted-foreground">{w.seats_remaining} seats remaining.</p>
            ) : null}
          </div>
        </div>

        {/* Agenda */}
        {agendaItems.length > 0 ? (
          <section className="mt-6 rounded-xl border border-border bg-card p-6 shadow-elev-xs sm:p-8">
            <h2 className="text-lg font-semibold text-foreground">What you&apos;ll learn</h2>
            <ul className="mt-3 space-y-2">
              {agendaItems.map((item, i) => (
                <li key={i} className="flex gap-2 text-sm text-foreground/85">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* Presenters */}
        {w.presenters.length > 0 ? (
          <section className="mt-6 rounded-xl border border-border bg-card p-6 shadow-elev-xs sm:p-8">
            <h2 className="text-lg font-semibold text-foreground">Presenters</h2>
            <div className="mt-4 space-y-5">
              {w.presenters.map((p, i) => (
                <div key={i} className="flex gap-4">
                  {p.headshot_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.headshot_url} alt={p.name} className="h-14 w-14 shrink-0 rounded-full object-cover" />
                  ) : (
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground" aria-hidden>
                      {p.name.slice(0, 1)}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="font-medium text-foreground">{p.name}</div>
                    <div className="text-sm text-muted-foreground">
                      {[p.title, p.firm].filter(Boolean).join(' · ')}
                    </div>
                    {p.bio ? <p className="mt-1 text-sm text-foreground/80">{p.bio}</p> : null}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <p className="mt-6 px-1 text-xs leading-relaxed text-muted-foreground">
          This is an educational event. It is informational only and is not a recommendation to buy, sell, or hold any
          insurance or investment product.
        </p>
      </article>
    </PublicPage>
  )
}
