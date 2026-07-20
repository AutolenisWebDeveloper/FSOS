'use client'

import * as React from 'react'
import { ExternalLink, CalendarCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Appointment scheduler. When a Calendly URL is configured it lazily mounts an
 * inline iframe once the section scrolls into view (so it never blocks initial
 * page load), and always exposes an accessible "open in a new tab" fallback link.
 * When no URL is set, it degrades to a prominent booking CTA pointing at the
 * public workshops/booking route. A plain iframe (not Calendly's JS widget) keeps
 * it CSP-friendly and dependency-free.
 */
export function CalendlyEmbed({ url }: { url: string }) {
  const isCalendly = url.startsWith('http')
  const ref = React.useRef<HTMLDivElement | null>(null)
  const [visible, setVisible] = React.useState(false)

  React.useEffect(() => {
    if (!isCalendly) return
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true)
          io.disconnect()
        }
      },
      { rootMargin: '200px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [isCalendly])

  if (!isCalendly) {
    return (
      <div className="flex flex-col items-start gap-4 rounded-2xl border border-border bg-card p-6 shadow-elev-xs">
        <p className="text-sm leading-relaxed text-muted-foreground">
          Pick a time that works for you and we’ll confirm your consultation. Prefer to talk first? Call or send a
          message and we’ll find a time together.
        </p>
        <Button asChild size="lg" variant="destructive">
          <a href={url}>
            <CalendarCheck className="h-5 w-5" aria-hidden />
            View available times
          </a>
        </Button>
      </div>
    )
  }

  const src = `${url}${url.includes('?') ? '&' : '?'}hide_gdpr_banner=1&background_color=ffffff&primary_color=0b5fcc`
  return (
    <div ref={ref} className="overflow-hidden rounded-2xl border border-border bg-card shadow-elev-xs">
      {visible ? (
        <iframe
          src={src}
          title="Schedule a consultation with Markist Athelus"
          loading="lazy"
          className="h-[640px] w-full border-0"
        />
      ) : (
        <div className="flex h-[640px] w-full items-center justify-center bg-muted/40">
          <span className="shimmer h-10 w-40 rounded-md" aria-hidden />
          <span className="sr-only">Loading scheduler…</span>
        </div>
      )}
      <div className="border-t border-border p-3 text-center">
        <a
          href={url}
          target="_blank"
          rel="noopener"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded"
        >
          <ExternalLink className="h-4 w-4" aria-hidden />
          Open the scheduler in a new tab
        </a>
      </div>
    </div>
  )
}
