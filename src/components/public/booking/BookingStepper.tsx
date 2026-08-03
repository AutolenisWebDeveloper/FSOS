// src/components/public/booking/BookingStepper.tsx
// Accessible progress indicator for the public booking flow (P1). Presentational and driven
// PURELY by step-model (BOOKING_STEPS / stepIndex / stepLabel) so the on-screen progress and
// the rendered step can never disagree — the flow computes `current` from the same model.
//
// A11y: a semantic ordered list inside a labelled <nav>; the active step carries
// aria-current="step"; status is conveyed by ICON (check) + TEXT (sr-only "completed/current/
// upcoming") + color together — never color alone (CLAUDE.md §13.1 / WCAG 2.2 AA).
'use client'

import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { BOOKING_STEPS, stepIndex, stepLabel, type BookingStep } from './step-model'

type Status = 'completed' | 'current' | 'upcoming'

function statusOf(index: number, currentIndex: number): Status {
  if (index < currentIndex) return 'completed'
  if (index === currentIndex) return 'current'
  return 'upcoming'
}

export function BookingStepper({
  current,
  steps = BOOKING_STEPS,
}: {
  current: BookingStep
  /** The steps to render. Defaults to all; a single-type booking omits `type` (never performed). */
  steps?: readonly BookingStep[]
}) {
  // Index is relative to the RENDERED list, so numbering + completed/current status stay correct
  // even when `type` is omitted. Fall back to the canonical index if `current` isn't in the list.
  const currentIndex = steps.includes(current) ? steps.indexOf(current) : stepIndex(current)
  const total = steps.length

  return (
    <nav aria-label="Booking progress" className="mb-5">
      {/* Compact caption for narrow screens where per-step labels are hidden. */}
      <p className="mono-label mb-2 text-muted-foreground sm:hidden">
        Step {currentIndex + 1} of {total} · {stepLabel(current)}
      </p>

      <ol className="flex items-center">
        {steps.map((step, i) => {
          const status = statusOf(i, currentIndex)
          const lineActive = i <= currentIndex // connector leading into a done/current step
          return (
            <li
              key={step}
              aria-current={status === 'current' ? 'step' : undefined}
              className={cn('flex items-center', i > 0 && 'min-w-0 flex-1')}
            >
              {i > 0 ? (
                <span
                  aria-hidden
                  className={cn(
                    'mx-1.5 h-0.5 flex-1 rounded-full transition-colors sm:mx-2.5',
                    lineActive ? 'bg-primary' : 'bg-border',
                  )}
                />
              ) : null}

              <span className="flex shrink-0 items-center gap-2">
                <span
                  aria-hidden
                  className={cn(
                    'flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold transition-colors',
                    status === 'completed' && 'border-primary bg-primary text-primary-foreground',
                    status === 'current' &&
                      'border-primary bg-primary text-primary-foreground ring-2 ring-ring/40 ring-offset-1 ring-offset-card',
                    status === 'upcoming' && 'border-border bg-card text-muted-foreground',
                  )}
                >
                  {status === 'completed' ? <Check className="h-4 w-4" strokeWidth={2.5} /> : i + 1}
                </span>

                <span
                  className={cn(
                    'hidden text-xs font-medium sm:inline',
                    status === 'upcoming' ? 'text-muted-foreground' : 'text-foreground',
                  )}
                >
                  {stepLabel(step)}
                </span>

                {/* Status for assistive tech — never rely on color alone. */}
                <span className="sr-only">
                  {stepLabel(step)}:{' '}
                  {status === 'completed' ? 'completed' : status === 'current' ? 'current step' : 'upcoming'}
                </span>
              </span>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
