import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { CalendarClock, PlayCircle, ShieldAlert, Lock } from 'lucide-react'
import { PublicPage, PublicBrandLockup } from '@/components/public/PublicShell'
import { WorkshopFeedbackForm } from '@/components/public/WorkshopFeedbackForm'
import { loadReplay } from '@/lib/workshops/replay'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const metadata: Metadata = { title: 'Workshop replay' }

// Public replay page (/workshops/[slug]/replay). Access-gated + finite-window + recording-
// consent-gated (spec §C). The recording is NEVER served until an approved recording-consent
// disclosure exists (precondition 4 — retained-communication rule). Reached via the
// registrant's personalized link carrying ?t=<join_token>.
export default async function WorkshopReplayPage(props: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ t?: string }>
}) {
  const { slug } = await props.params
  const { t } = await props.searchParams
  const nowIso = new Date().toISOString()
  const view = await loadReplay(slug, t ?? null, nowIso)
  if (!view) notFound()

  const consultUrl = process.env.NEXT_PUBLIC_CALENDLY_URL || '/workshops'
  const expiresLabel = view.recordingExpiresAt
    ? new Date(view.recordingExpiresAt).toLocaleDateString('en-US', { dateStyle: 'long' })
    : null

  return (
    <PublicPage>
      <div className="w-full max-w-2xl">
        <PublicBrandLockup />
        <div className="rounded-xl border border-border bg-card p-6 shadow-elev-xs sm:p-8">
          <span className="inline-flex items-center rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-medium text-primary">
            Educational replay
          </span>
          <h1 className="mt-3 text-xl font-semibold text-foreground">{view.title}</h1>

          {/* ── Recording surface, gated ─────────────────────────────────── */}
          {view.gate === 'available' ? (
            <div className="mt-5">
              <div className="relative w-full overflow-hidden rounded-lg border border-border bg-black" style={{ aspectRatio: '16 / 9' }}>
                <iframe
                  src={view.recordingUrl ?? ''}
                  title={`${view.title} — recording`}
                  className="absolute inset-0 h-full w-full"
                  allow="fullscreen"
                  allowFullScreen
                />
              </div>
              {expiresLabel ? (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <CalendarClock className="h-3.5 w-3.5" aria-hidden /> Available through {expiresLabel}.
                </p>
              ) : null}
              {view.recordingDisclosure ? (
                <p className="mt-3 rounded-md border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                  {view.recordingDisclosure}
                </p>
              ) : null}
            </div>
          ) : (
            <ReplayGateNotice gate={view.gate} expiresLabel={expiresLabel} consultUrl={consultUrl} />
          )}

          {/* ── Feedback survey (only for a valid registrant) ─────────────── */}
          {view.feedbackToken ? (
            <div className="mt-8 border-t pt-6">
              <h2 className="text-base font-semibold text-foreground">Tell us how it went</h2>
              <p className="mt-1 text-sm text-muted-foreground">Your feedback helps us improve future sessions.</p>
              <div className="mt-4">
                <WorkshopFeedbackForm token={view.feedbackToken} />
              </div>
            </div>
          ) : null}

          {/* ── Book-a-consult CTA (always offered — no dead ends) ────────── */}
          <div className="mt-8 border-t pt-6">
            <h2 className="text-base font-semibold text-foreground">Have questions?</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Book a no-obligation educational review with a specialist.
            </p>
            <Link
              href={consultUrl}
              className="mt-3 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Book a 1:1 review
            </Link>
          </div>
        </div>
      </div>
    </PublicPage>
  )
}

function ReplayGateNotice({
  gate,
  expiresLabel,
  consultUrl,
}: {
  gate: 'not_approved' | 'no_access' | 'not_available' | 'window_closed'
  expiresLabel: string | null
  consultUrl: string
}) {
  const map = {
    not_approved: {
      icon: ShieldAlert,
      title: 'Recording not yet available',
      body: 'This recording is being prepared for release and will be posted here once ready.',
    },
    no_access: {
      icon: Lock,
      title: 'Please use your personal link',
      body: 'The replay opens from the personalized link in your confirmation and reminder emails.',
    },
    not_available: {
      icon: PlayCircle,
      title: 'Recording coming soon',
      body: 'We’re processing the recording. Check back shortly — registrants get an email when it’s live.',
    },
    window_closed: {
      icon: CalendarClock,
      title: 'Recording no longer available',
      body: expiresLabel
        ? `The replay window closed on ${expiresLabel}. Book a 1:1 to get your questions answered.`
        : 'The replay window has closed. Book a 1:1 to get your questions answered.',
    },
  } as const
  const { icon: Icon, title, body } = map[gate]
  return (
    <div className="mt-5 rounded-lg border border-border bg-muted/40 p-6 text-center">
      <Icon className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden />
      <p className="mt-2 text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
      {gate === 'window_closed' ? (
        <Link
          href={consultUrl}
          className="mt-4 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Book a 1:1 review
        </Link>
      ) : null}
    </div>
  )
}
