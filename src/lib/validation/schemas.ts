// src/lib/validation/schemas.ts
// Zod is the single source of truth for every P0 form + API input (CLAUDE.md §1.7).
// The same schema validates on the client (inline errors) and the server (reject
// bad writes), and TS types are derived via z.infer — never hand-authored.

import { z } from 'zod'

// ─── Shared primitives ────────────────────────────────────────────────────────
export const uuid = z.string().uuid()
const optionalEmail = z
  .string()
  .trim()
  .email('Enter a valid email')
  .optional()
  .or(z.literal('').transform(() => undefined))
const optionalPhone = z
  .string()
  .trim()
  .min(7, 'Enter a valid phone')
  .max(32)
  .regex(/^[0-9+().\-\s]+$/, 'Digits and + ( ) - only')
  .optional()
  .or(z.literal('').transform(() => undefined))
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')

// ─── Enums (mirror the DB CHECK constraints in migration 009) ──────────────────
export const AGENCY_STATUS = ['prospective', 'activated', 'producing', 'dormant', 'terminated'] as const
export const REFERRAL_ENGAGEMENT = ['warm_handoff', 'co_sell', 'direct'] as const
export const REFERRAL_STATUS = ['received', 'working', 'converted', 'declined'] as const
export const POLICY_STATUS = ['quoted', 'bound', 'active', 'lapsed', 'cancelled', 'non_renewed', 'renewed'] as const
export const OPPORTUNITY_STAGE = [
  'prospect',
  'fact_find',
  'quoted_proposed',
  'application',
  'underwriting_suitability',
  'placed_issued',
  'lost',
] as const
export const PRODUCT_FAMILY = ['life', 'annuity', 'investment', 'education'] as const
export const CONSENT_CHANNEL = ['call', 'sms', 'email'] as const

// Loss reasons are config-driven per spec; the P0 list is a labeled, editable default.
export const REFERRAL_LOSS_REASONS = [
  'no_contact',
  'not_interested',
  'not_a_fit',
  'already_covered',
  'duplicate',
  'client_declined',
  'other',
] as const

// ─── Agency Network (OS-02) ────────────────────────────────────────────────────
export const AgencyCreateSchema = z.object({
  agency_name: z.string().trim().min(1, 'Agency name is required').max(200),
  owner_name: z.string().trim().min(1, 'Owner name is required').max(200),
  owner_email: optionalEmail,
  owner_phone: optionalPhone,
  district_id: uuid.optional().or(z.literal('').transform(() => undefined)),
  status: z.enum(AGENCY_STATUS).default('prospective'),
  checkin_interval_days: z.coerce.number().int().min(1).max(365).default(30),
  pc_book_policies: z.coerce.number().int().min(0).default(0),
  life_policies_in_force: z.coerce.number().int().min(0).default(0),
})
export type AgencyCreate = z.infer<typeof AgencyCreateSchema>

export const AgencyPatchSchema = z
  .object({
    agency_name: z.string().trim().min(1).max(200).optional(),
    owner_name: z.string().trim().min(1).max(200).optional(),
    owner_email: optionalEmail,
    owner_phone: optionalPhone,
    status: z.enum(AGENCY_STATUS).optional(),
    checkin_interval_days: z.coerce.number().int().min(1).max(365).optional(),
    archived: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'No fields to update')
export type AgencyPatch = z.infer<typeof AgencyPatchSchema>

// ─── Referral (OS-03) ──────────────────────────────────────────────────────────
export const ReferralCreateSchema = z.object({
  referred_name: z.string().trim().min(1, 'Referred name is required').max(200),
  referring_agency_id: uuid.optional().or(z.literal('').transform(() => undefined)),
  engagement: z.enum(REFERRAL_ENGAGEMENT).default('warm_handoff'),
  referred_email: optionalEmail,
  referred_phone: optionalPhone,
  note: z.string().trim().max(2000).optional(),
  // Consent captured at intake (public form / staff entry).
  consent_sms: z.boolean().default(false),
  consent_email: z.boolean().default(false),
})
export type ReferralCreate = z.infer<typeof ReferralCreateSchema>

export const ReferralRejectSchema = z.object({
  loss_reason: z.enum(REFERRAL_LOSS_REASONS),
  note: z.string().trim().max(2000).optional(),
})
export type ReferralReject = z.infer<typeof ReferralRejectSchema>

// Referral → household/opportunity conversion (the WF-1 spine step).
export const ReferralConvertSchema = z.object({
  // Step 1 — match or create the household.
  household_id: uuid.optional(), // present → match existing; absent → create
  primary_name: z.string().trim().min(1, 'Household name is required').max(200),
  // Step 2 — first member + consent confirmation.
  member_full_name: z.string().trim().min(1, 'Member name is required').max(200),
  member_dob: isoDate.optional().or(z.literal('').transform(() => undefined)),
  member_email: optionalEmail,
  member_phone: optionalPhone,
  // Step 3 — opportunity.
  member_consent_sms: z.boolean().default(false),
  member_consent_email: z.boolean().default(false),
  engagement: z.enum(REFERRAL_ENGAGEMENT),
  product_id: uuid.optional().or(z.literal('').transform(() => undefined)),
  expected_premium: z.coerce.number().min(0).optional(),
  expected_aum: z.coerce.number().min(0).optional(),
  // Idempotency: retrying a conversion must not create duplicates.
  idempotency_key: z.string().trim().min(8).max(200),
})
export type ReferralConvert = z.infer<typeof ReferralConvertSchema>

// DOB must not be in the future.
export const dobNotFuture = (d: string | undefined) => {
  if (!d) return true
  return new Date(d) <= new Date()
}

// ─── Household & Members (OS-04) ───────────────────────────────────────────────
export const HouseholdCreateSchema = z.object({
  primary_name: z.string().trim().min(1, 'Household name is required').max(200),
  referring_agency_id: uuid.optional().or(z.literal('').transform(() => undefined)),
  address: z.string().trim().max(300).optional(),
  city: z.string().trim().max(120).optional(),
  state: z.string().trim().max(2).optional(),
  zip: z.string().trim().max(10).optional(),
})
export type HouseholdCreate = z.infer<typeof HouseholdCreateSchema>

export const HouseholdPatchSchema = z
  .object({
    primary_name: z.string().trim().min(1).max(200).optional(),
    address: z.string().trim().max(300).optional(),
    city: z.string().trim().max(120).optional(),
    state: z.string().trim().max(2).optional(),
    zip: z.string().trim().max(10).optional(),
    do_not_contact: z.boolean().optional(),
    archived: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'No fields to update')

export const MemberBaseSchema = z.object({
  full_name: z.string().trim().min(1, 'Full name is required').max(200),
  relationship: z.string().trim().max(60).optional(),
  dob: isoDate.optional().or(z.literal('').transform(() => undefined)),
  email: optionalEmail,
  phone: optionalPhone,
})
export const MemberCreateSchema = MemberBaseSchema.refine((v) => dobNotFuture(v.dob), {
  message: 'Date of birth cannot be in the future',
  path: ['dob'],
})
export type MemberCreate = z.infer<typeof MemberCreateSchema>

// ─── Policy & Coverage (OS-05) ─────────────────────────────────────────────────
export const PolicyCreateSchema = z.object({
  household_id: uuid,
  carrier_id: uuid.optional().or(z.literal('').transform(() => undefined)),
  product_id: uuid.optional().or(z.literal('').transform(() => undefined)),
  policy_number: z.string().trim().max(80).optional(),
  status: z.enum(POLICY_STATUS).default('active'),
  is_with_us: z.boolean().default(true),
  premium: z.coerce.number().min(0).optional(),
  effective_date: isoDate.optional().or(z.literal('').transform(() => undefined)),
  renewal_date: isoDate.optional().or(z.literal('').transform(() => undefined)),
  x_date: isoDate.optional().or(z.literal('').transform(() => undefined)),
  conversion_deadline: isoDate.optional().or(z.literal('').transform(() => undefined)),
})
export type PolicyCreate = z.infer<typeof PolicyCreateSchema>

// ─── Opportunity & Pipeline (OS-09) ────────────────────────────────────────────
export const OpportunityCreateSchema = z.object({
  household_id: uuid,
  engagement: z.enum(REFERRAL_ENGAGEMENT),
  product_id: uuid.optional().or(z.literal('').transform(() => undefined)),
  referring_agency_id: uuid.optional().or(z.literal('').transform(() => undefined)),
  referral_id: uuid.optional(),
  expected_premium: z.coerce.number().min(0).optional(),
  expected_aum: z.coerce.number().min(0).optional(),
  expected_commission: z.coerce.number().min(0).optional(),
})
export type OpportunityCreate = z.infer<typeof OpportunityCreateSchema>

export const OpportunityStageSchema = z.object({
  stage: z.enum(OPPORTUNITY_STAGE),
  note: z.string().trim().max(1000).optional(),
})
export type OpportunityStage = z.infer<typeof OpportunityStageSchema>

// ─── Tasks (OS-14) ─────────────────────────────────────────────────────────────
export const TaskCreateSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(300),
  due_at: z.string().datetime().optional().or(isoDate.optional()).or(z.literal('').transform(() => undefined)),
  entity_type: z.string().trim().max(60).optional(),
  entity_id: uuid.optional(),
})
export type TaskCreate = z.infer<typeof TaskCreateSchema>

export const TaskPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(300).optional(),
    due_at: z.string().optional().nullable(),
    completed: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'No fields to update')

// ─── Consent (OS-16 / public token) ────────────────────────────────────────────
export const ConsentCaptureSchema = z.object({
  household_id: uuid.optional(),
  member_id: uuid.optional(),
  channel: z.enum(CONSENT_CHANNEL),
  status: z.enum(['granted', 'revoked']).default('granted'),
  source: z.string().trim().max(120).optional(),
})
export type ConsentCapture = z.infer<typeof ConsentCaptureSchema>
