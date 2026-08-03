// src/components/public/booking/TypeCard.tsx
// Appointment-type card for the public /schedule chooser (P1). Presentational + server-safe;
// renders only fields the backend supplies (name, description, duration, meeting mode) and
// links to the flow via a real route (?type=<slug>) — never hardcodes or invents a type.
import Link from 'next/link'
import { meetingModeLabel } from '@/lib/booking/display'

export interface TypeCardData {
  slug: string
  name: string
  description: string | null
  durationMinutes: number
  meetingMode: string
}

/** Minimal, mode-appropriate glyph (decorative — labels carry the meaning). */
function ModeGlyph({ mode }: { mode: string }) {
  const common = 'h-4 w-4'
  if (mode === 'phone') {
    return (
      <svg viewBox="0 0 20 20" fill="currentColor" className={common} aria-hidden>
        <path d="M2 3.5A1.5 1.5 0 013.5 2h1.7a1.5 1.5 0 011.46 1.14l.6 2.4a1.5 1.5 0 01-.4 1.45l-1 1a11 11 0 004.6 4.6l1-1a1.5 1.5 0 011.45-.4l2.4.6A1.5 1.5 0 0118 14.8v1.7A1.5 1.5 0 0116.5 18 14.5 14.5 0 012 3.5z" />
      </svg>
    )
  }
  if (mode === 'in_person') {
    return (
      <svg viewBox="0 0 20 20" fill="currentColor" className={common} aria-hidden>
        <path d="M10 2a3.5 3.5 0 100 7 3.5 3.5 0 000-7zM3.5 16.5a6.5 6.5 0 0113 0 .5.5 0 01-.5.5H4a.5.5 0 01-.5-.5z" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={common} aria-hidden>
      <path d="M3 5.5A1.5 1.5 0 014.5 4h7A1.5 1.5 0 0113 5.5v1.2l3.3-1.9a.75.75 0 011.13.65v9.1a.75.75 0 01-1.13.65L13 13.3v1.2A1.5 1.5 0 0111.5 16h-7A1.5 1.5 0 013 14.5v-9z" />
    </svg>
  )
}

export function TypeCard({ type }: { type: TypeCardData }) {
  return (
    <Link
      href={`/schedule?type=${encodeURIComponent(type.slug)}`}
      className="group flex items-start gap-4 rounded-xl border border-border bg-card p-5 shadow-elev-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-elev-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <span
        aria-hidden
        className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground"
      >
        <ModeGlyph mode={type.meetingMode} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-foreground">{type.name}</span>
        {type.description ? (
          <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">{type.description}</span>
        ) : null}
        <span className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{type.durationMinutes} min</span>
          <span aria-hidden>·</span>
          <span>{meetingModeLabel(type.meetingMode)}</span>
        </span>
      </span>
      <span
        aria-hidden
        className="mt-1 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
          <path
            fillRule="evenodd"
            d="M7.3 4.3a1 1 0 011.4 0l5 5a1 1 0 010 1.4l-5 5a1 1 0 01-1.4-1.4L11.58 10 7.3 5.7a1 1 0 010-1.4z"
            clipRule="evenodd"
          />
        </svg>
      </span>
    </Link>
  )
}
