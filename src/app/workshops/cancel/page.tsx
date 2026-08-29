import type { Metadata } from 'next'
import Link from 'next/link'
import { CalendarDays, CheckCircle2, Clock, LinkIcon } from 'lucide-react'
import { PublicPage, PublicBrandLockup } from '@/components/public/PublicShell'
import { WorkshopCancelConfirm } from '@/components/public/WorkshopCancelConfirm'
import { loadRegistrationForCancel } from '@/lib/workshops/public'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const metadata: Metadata = { title: 'Cancel registration — Workshop', robots: { index: false, follow: false } }

// Registrant self-cancel confirm page (WS-009), reached from the personalized
// cancel link (?token=<join_token>) in confirmation/reminder messages. The page shows
// exactly what will be cancelled and requires an explicit confirm click — a mail
// client prefetching the link must never cancel anyone (that is why the cancellation
// itself is a POST from the button, never a GET side effect).
export default async function WorkshopCancelPage(props: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await props.searchParams
  const lookup = token ? await loadRegistrationForCancel(token) : null

  return (
    <PublicPage>
      <div className="w-full max-w-xl">
        <PublicBrandLockup />
        <div className="rounded-xl border border-border bg-card p-6 shadow-elev-xs sm:p-8">
          {!token || !lookup?.found ? (
            <>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                <LinkIcon aria-hidden className="h-3 w-3" />
                Link not recognized
              </span>
              <h1 className="mt-3 text-xl font-semibold text-foreground">We couldn&apos;t find that registration</h1>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                This cancellation link is incomplete or no longer valid. Open the most recent
                confirmation or reminder email for your workshop and use the cancellation link
                there, or reach out and we&apos;ll take care of it.
              </p>
              <p className="mt-4 text-sm">
                <Link href="/contact" className="font-medium text-primary underline underline-offset-2">
                  Contact us
                </Link>
                <span className="mx-2 text-muted-foreground">·</span>
                <Link href="/workshops" className="font-medium text-primary underline underline-offset-2">
                  Browse upcoming workshops
                </Link>
              </p>
            </>
          ) : lookup.already_cancelled ? (
            <>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-status-won/10 px-2.5 py-0.5 text-xs font-medium text-status-won">
                <CheckCircle2 aria-hidden className="h-3 w-3" />
                Already cancelled
              </span>
              <h1 className="mt-3 text-xl font-semibold text-foreground">This registration is already cancelled</h1>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {lookup.workshop_title ? (
                  <>
                    Your registration for <strong className="text-foreground">{lookup.workshop_title}</strong> was
                    cancelled earlier — no reminders are being sent.
                  </>
                ) : (
                  'Your registration was cancelled earlier — no reminders are being sent.'
                )}{' '}
                If you&apos;d like to attend after all, you can register again while seats remain.
              </p>
              <p className="mt-4 text-sm">
                <Link href="/workshops" className="font-medium text-primary underline underline-offset-2">
                  See upcoming workshops
                </Link>
              </p>
            </>
          ) : lookup.past ? (
            <>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                <Clock aria-hidden className="h-3 w-3" />
                Event has passed
              </span>
              <h1 className="mt-3 text-xl font-semibold text-foreground">This workshop has already taken place</h1>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                There&apos;s nothing to cancel{lookup.workshop_title ? (
                  <>
                    {' '}— <strong className="text-foreground">{lookup.workshop_title}</strong> has already happened
                  </>
                ) : null}
                . We&apos;d love to see you at a future session.
              </p>
              <p className="mt-4 text-sm">
                <Link href="/workshops" className="font-medium text-primary underline underline-offset-2">
                  See upcoming workshops
                </Link>
              </p>
            </>
          ) : (
            <>
              <span className="inline-flex items-center rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-medium text-primary">
                Cancel registration
              </span>
              <h1 className="mt-3 text-xl font-semibold text-foreground">Cancel your workshop registration?</h1>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                You&apos;re about to cancel your seat
                {lookup.workshop_title ? (
                  <>
                    {' '}for <strong className="text-foreground">{lookup.workshop_title}</strong>
                  </>
                ) : null}
                .
              </p>
              {lookup.when_local ? (
                <p className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-sunken px-3 py-2 text-sm text-foreground">
                  <CalendarDays aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
                  {lookup.when_local}
                </p>
              ) : null}
              <WorkshopCancelConfirm token={token} />
            </>
          )}
        </div>
      </div>
    </PublicPage>
  )
}
