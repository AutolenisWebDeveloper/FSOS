// src/components/public/booking/ScheduleHero.tsx
// Premium hero for the public /schedule chooser (P1). Server-safe, token-only, and built
// STRICTLY from approved content (CLAUDE.md §4.3, §17): the FSA's real identity + licensing +
// service area from lib/site, and the meeting formats actually offered by the active
// appointment types. No testimonials, ratings, awards, client counts, experience figures, or
// fiduciary/performance claims. The privacy line reflects the real public-surface rule (no
// sensitive data collected here).

import type { ReactNode } from 'react'
import { BUSINESS, CONTACT, LICENSING } from '@/lib/site'
import { meetingModeLabel } from '@/lib/booking/display'

/** A quiet, factual meta chip. */
function MetaChip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
      {children}
    </span>
  )
}

export function ScheduleHero({ formats = [] }: { formats?: string[] }) {
  return (
    <section className="mb-8">
      <p className="mono-label text-primary">Schedule a consultation</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
        Book time with {BUSINESS.agent}
      </h1>
      <p className="mt-3 max-w-xl text-base leading-relaxed text-muted-foreground">
        Choose the meeting that fits, then pick a time in your own timezone. It takes about a minute — no account
        numbers or sensitive documents needed here.
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {formats.length > 0 ? <MetaChip>{formats.map((f) => meetingModeLabel(f)).join(' · ')}</MetaChip> : null}
        <MetaChip>Times in your timezone</MetaChip>
        <MetaChip>{CONTACT.serviceArea}</MetaChip>
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        {BUSINESS.title}, {BUSINESS.carrier} · {LICENSING}
      </p>
    </section>
  )
}
