import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { CheckCircle2, CalendarDays, MapPin, Video, Users } from 'lucide-react'
import { PublicPage, PublicBrandLockup } from '@/components/public/PublicShell'
import { loadPublicWorkshop } from '@/lib/workshops/public'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const metadata: Metadata = { title: 'You’re registered — Workshop' }

// Confirmation page (/workshops/[slug]/confirmed). Reached after a successful registration.
// Shows the details + what happens next. (Add-to-calendar / .ics is P3.)
export default async function WorkshopConfirmedPage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params
  const w = await loadPublicWorkshop(slug)
  if (!w) notFound()

  const when = w.scheduled_at
    ? new Date(w.scheduled_at).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })
    : 'Date to be announced'
  const Icon = w.delivery_mode === 'virtual' ? Video : w.delivery_mode === 'hybrid' ? Users : MapPin
  const place =
    w.delivery_mode === 'virtual'
      ? 'Online — your join link will arrive by email before the event.'
      : w.venue_address ?? w.location ?? 'Location details to follow.'

  return (
    <PublicPage>
      <div className="w-full max-w-lg">
        <PublicBrandLockup />
        <div className="rounded-xl border border-border bg-card p-6 shadow-elev-xs sm:p-8">
          <div className="rounded-lg border border-status-won/20 bg-status-won/10 p-6 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-status-won" aria-hidden />
            <h1 className="mt-2 text-lg font-semibold text-foreground">You&apos;re registered!</h1>
            <p className="mt-1 text-sm text-muted-foreground">A confirmation is on its way. We&apos;ll remind you before the event.</p>
          </div>

          <div className="mt-6">
            <h2 className="text-base font-semibold text-foreground">{w.title}</h2>
            <dl className="mt-3 space-y-2 text-sm text-foreground/85">
              <div className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-muted-foreground" aria-hidden /> {when}
              </div>
              <div className="flex items-start gap-2">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden /> <span>{place}</span>
              </div>
            </dl>
          </div>

          <div className="mt-6 border-t pt-4">
            <h3 className="text-sm font-medium text-foreground">What happens next</h3>
            <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
              <li>• We&apos;ll email your confirmation and reminders before the event.</li>
              {w.delivery_mode !== 'in_person' ? <li>• Your unique join link arrives ahead of the session.</li> : null}
              <li>• Questions? Reply to any of our emails and a specialist will help.</li>
            </ul>
          </div>

          <Link
            href="/workshops"
            className="mt-6 inline-flex items-center justify-center rounded-md border border-input bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
          >
            Browse more workshops
          </Link>
        </div>
      </div>
    </PublicPage>
  )
}
