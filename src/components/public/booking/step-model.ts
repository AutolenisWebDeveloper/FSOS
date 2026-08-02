// src/components/public/booking/step-model.ts
// PURE, dependency-free model for the public booking progression (P1). No React, no DOM,
// no clock — so the step derivation and labels are unit-provable in isolation (mirrors the
// booking-ics / availability test pattern: compiled standalone and required). The client
// BookingFlow derives its visible step from this so the on-screen stepper and the flow can
// never disagree.

export type BookingStep = 'type' | 'slot' | 'details' | 'review' | 'confirmed'

/** Ordered progression. `type` is only shown when the booker chooses among multiple types;
 *  a single-type booking starts at `slot`. The stepper renders these in order. */
export const BOOKING_STEPS: readonly BookingStep[] = ['type', 'slot', 'details', 'review', 'confirmed'] as const

const STEP_LABELS: Record<BookingStep, string> = {
  type: 'Meeting type',
  slot: 'Date & time',
  details: 'Your details',
  review: 'Review',
  confirmed: 'Confirmed',
}

/** Human label for a step (stepper + a11y names). */
export function stepLabel(step: BookingStep): string {
  return STEP_LABELS[step]
}

/** Zero-based position of a step in the canonical order. */
export function stepIndex(step: BookingStep): number {
  return BOOKING_STEPS.indexOf(step)
}

export interface BookingProgress {
  /** The booker has selected an appointment type (or only one exists). */
  hasType: boolean
  /** A specific slot is chosen. */
  hasSlot: boolean
  /** The details form validated and the review step is showing. */
  reviewing: boolean
  /** The booking succeeded. */
  confirmed: boolean
}

/**
 * The single source of truth for "which step is the booker on". Highest completed gate wins:
 * confirmed → review → details → slot → type. Keeping this pure means the stepper indicator
 * and the rendered step are always computed the same way from the same state.
 */
export function deriveStep(p: BookingProgress): BookingStep {
  if (p.confirmed) return 'confirmed'
  if (p.reviewing) return 'review'
  if (p.hasSlot) return 'details'
  if (p.hasType) return 'slot'
  return 'type'
}

/** The steps strictly before `current` (rendered as completed in the stepper). */
export function completedSteps(current: BookingStep): BookingStep[] {
  return BOOKING_STEPS.slice(0, stepIndex(current))
}
