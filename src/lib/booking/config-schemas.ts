// src/lib/booking/config-schemas.ts
// Zod validation for the FSA booking-configuration surface (Slice 2) + a few pure
// helpers. Kept dependency-light (Zod + Intl only) so the cross-field rules are
// unit-provable offline. Every write route parses its input through these before any
// DB call — no unvalidated write reaches the config tables (CLAUDE.md §3.1.7).

import { z } from 'zod'

export const MEETING_MODES = ['video', 'phone', 'in_person'] as const
export type MeetingMode = (typeof MEETING_MODES)[number]

/** True iff `tz` is a timezone the runtime's Intl database recognizes. */
export function isValidIanaZone(tz: unknown): boolean {
  if (typeof tz !== 'string' || !tz.trim()) return false
  try {
    // Throws RangeError for an unknown zone.
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

const HHMM = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be HH:MM (24-hour), e.g. 09:00 or 17:30')
const YMD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
const IANA = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine(isValidIanaZone, { message: 'Unknown IANA timezone (e.g. America/Chicago)' })
const SLUG = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase letters, numbers, and hyphens')

// ── Appointment types ────────────────────────────────────────────────────────────
export const AppointmentTypeCreate = z.object({
  name: z.string().trim().min(1).max(120),
  slug: SLUG,
  description: z.string().trim().max(2000).nullish(),
  duration_minutes: z.number().int().min(5).max(480),
  buffer_before_minutes: z.number().int().min(0).max(480).default(0),
  buffer_after_minutes: z.number().int().min(0).max(480).default(0),
  min_notice_minutes: z.number().int().min(0).max(43200).default(240), // ≤ 30 days
  max_lead_days: z.number().int().min(1).max(365).default(60),
  max_per_day: z.number().int().min(1).max(100).nullish(),
  slot_interval_minutes: z.number().int().min(5).max(480).default(30),
  meeting_mode: z.enum(MEETING_MODES).default('video'),
  review_type: z.string().trim().max(80).nullish(),
  color: z.string().trim().max(40).nullish(),
  active: z.boolean().default(true),
})
export type AppointmentTypeCreateInput = z.infer<typeof AppointmentTypeCreate>

// Update: every field optional; nothing else re-defaulted (partial patch semantics).
export const AppointmentTypeUpdate = AppointmentTypeCreate.partial()
export type AppointmentTypeUpdateInput = z.infer<typeof AppointmentTypeUpdate>

// ── Availability rules ───────────────────────────────────────────────────────────
const availabilityRuleShape = z.object({
  weekday: z.number().int().min(0).max(6), // 0=Sun … 6=Sat
  start_time: HHMM,
  end_time: HHMM,
  timezone: IANA.default('America/Chicago'),
  effective_start: YMD.nullish(),
  effective_end: YMD.nullish(),
  active: z.boolean().default(true),
})

/** Cross-field checks shared by create + update (so a partial patch is validated too). */
export function availabilityRuleIssues(r: {
  start_time?: string
  end_time?: string
  effective_start?: string | null
  effective_end?: string | null
}): string[] {
  const issues: string[] = []
  if (r.start_time && r.end_time && r.end_time <= r.start_time) {
    issues.push('end_time must be after start_time')
  }
  if (r.effective_start && r.effective_end && r.effective_end < r.effective_start) {
    issues.push('effective_end must be on or after effective_start')
  }
  return issues
}

export const AvailabilityRuleCreate = availabilityRuleShape.superRefine((r, ctx) => {
  for (const message of availabilityRuleIssues(r)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: ['end_time'] })
  }
})
export type AvailabilityRuleCreateInput = z.infer<typeof AvailabilityRuleCreate>

export const AvailabilityRuleUpdate = availabilityRuleShape.partial().superRefine((r, ctx) => {
  for (const message of availabilityRuleIssues(r)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: ['end_time'] })
  }
})
export type AvailabilityRuleUpdateInput = z.infer<typeof AvailabilityRuleUpdate>

// ── Blackouts ────────────────────────────────────────────────────────────────────
export const BlackoutCreate = z
  .object({
    starts_at: z.string().datetime({ offset: true }),
    ends_at: z.string().datetime({ offset: true }),
    reason: z.string().trim().max(400).nullish(),
  })
  .superRefine((b, ctx) => {
    if (Date.parse(b.ends_at) <= Date.parse(b.starts_at)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'ends_at must be after starts_at', path: ['ends_at'] })
    }
  })
export type BlackoutCreateInput = z.infer<typeof BlackoutCreate>

// ── Public booking submission (Slice 3) ──────────────────────────────────────────
// The attendee-facing form. Deliberately collects ONLY scheduling + contact fields — no
// securities/financial data ever (firewall §4.1). `company` is an unrendered honeypot.
export const PublicBookingInput = z.object({
  typeSlug: SLUG,
  startsAt: z.string().datetime({ offset: true }),
  bookerTimezone: IANA,
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(200),
  phone: z
    .string()
    .trim()
    .max(40)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
  notes: z.string().trim().max(1000).optional().nullable(),
  /** Honeypot — a bot filling this is silently dropped by the route (not a validation error). */
  company: z.string().max(200).optional(),
})
export type PublicBookingInputType = z.infer<typeof PublicBookingInput>
