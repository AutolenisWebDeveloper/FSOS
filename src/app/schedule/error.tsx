'use client'

// src/app/schedule/error.tsx
// Route-level error boundary for /schedule. Plain-language recovery (§16.1) — no stack trace,
// no internal detail. Offers a retry (reset) and a way back to the site so the booker is
// never stranded.
import { useEffect } from 'react'
import { PublicPage, PublicCard } from '@/components/public/PublicShell'
import { PublicBrandHeader } from '@/components/public/booking/PublicBrandHeader'
import { Button } from '@/components/ui/button'
import { CONTACT } from '@/lib/site'

export default function ScheduleError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Surface to the error tracker without exposing anything to the booker.
    console.error('[schedule] route error', error?.digest ?? error?.message)
  }, [error])

  return (
    <PublicPage align="center">
      <div className="w-full max-w-lg">
        <PublicBrandHeader />
        <PublicCard subtitle="Scheduling">
          <h1 className="text-lg font-semibold text-foreground">We couldn&rsquo;t load the scheduler</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Something went wrong on our end. Your information wasn&rsquo;t affected. Try again in a moment, or reach us
            directly and we&rsquo;ll get you booked.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Button onClick={reset}>Try again</Button>
            <Button asChild variant="outline">
              <a href={`tel:${CONTACT.phoneE164}`}>Call {CONTACT.phoneDisplay}</a>
            </Button>
          </div>
        </PublicCard>
      </div>
    </PublicPage>
  )
}
