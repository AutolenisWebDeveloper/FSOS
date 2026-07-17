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

// ═══════════════════════════════════════════════════════════════════════════════
// P1 (professional launch) schemas — mirror migration 012 CHECK constraints.
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Financial Review (OS-06 / WF-2) ────────────────────────────────────────────
export const REVIEW_TYPE = ['policy', 'coverage', 'term_conversion', 'retirement', 'annual'] as const
export const REVIEW_STAGE = ['requested', 'scheduled', 'prepared', 'completed', 'outcome_logged'] as const

export const ReviewCreateSchema = z.object({
  household_id: uuid,
  type: z.enum(REVIEW_TYPE),
  scheduled_at: z.string().datetime().optional().or(isoDate.optional()).or(z.literal('').transform(() => undefined)),
  assigned_user: uuid.optional().or(z.literal('').transform(() => undefined)),
})
export type ReviewCreate = z.infer<typeof ReviewCreateSchema>

export const ReviewStageSchema = z.object({
  stage: z.enum(REVIEW_STAGE),
  note: z.string().trim().max(1000).optional(),
})

// The outcome records NEEDS + originates opportunities. It can NEVER be saved as a
// "recommendation" — there is no recommendation field. A discussed need may spawn
// one opportunity per product family (the FSA selects; the system records).
export const ReviewOutcomeSchema = z.object({
  goals: z.string().trim().max(4000).optional(),
  coverage_held: z.string().trim().max(4000).optional(),
  gaps_observed: z.string().trim().max(4000).optional(),
  life_events: z.string().trim().max(4000).optional(),
  meeting_notes: z.string().trim().max(8000).optional(),
  // Needs to originate as opportunities. Each is a coverage/product family + note.
  originate: z
    .array(
      z.object({
        product_id: uuid.optional().or(z.literal('').transform(() => undefined)),
        engagement: z.enum(REFERRAL_ENGAGEMENT).default('direct'),
        note: z.string().trim().max(500).optional(),
        expected_premium: z.coerce.number().min(0).optional(),
      }),
    )
    .max(20)
    .default([]),
  // Follow-up tasks to schedule.
  follow_ups: z.array(z.object({ title: z.string().trim().min(1).max(300), due_at: z.string().optional() })).max(20).default([]),
  // Compliance flags captured in the meeting.
  securities_discussed: z.boolean().default(false),
  replacement_discussed: z.boolean().default(false),
})
export type ReviewOutcome = z.infer<typeof ReviewOutcomeSchema>

// ─── Term Conversion + Cross-Sell (OS-07/08 / WF-3/4) ───────────────────────────
// The ONLY actions these expose. NO "recommend product" verb exists in this union.
export const GREEN_ZONE_VERBS = [
  'identify',
  'educate',
  'invite',
  'schedule',
  'remind',
  'follow_up',
  'escalate',
] as const
export type GreenZoneVerb = (typeof GREEN_ZONE_VERBS)[number]

export const OutreachActionSchema = z.object({
  action: z.enum(GREEN_ZONE_VERBS),
  policy_id: uuid.optional(),
  household_id: uuid.optional(),
  note: z.string().trim().max(1000).optional(),
})
export type OutreachAction = z.infer<typeof OutreachActionSchema>

// ─── Case Management (OS-10 / WF-1) ─────────────────────────────────────────────
export const CASE_STATUS = [
  'submitted',
  'underwriting',
  'requirements_outstanding',
  'approved',
  'issued',
  'in_service',
  'declined',
  'withdrawn',
] as const

export const CaseCreateSchema = z.object({
  opportunity_id: uuid,
  carrier_id: uuid.optional().or(z.literal('').transform(() => undefined)),
})
export type CaseCreate = z.infer<typeof CaseCreateSchema>

export const CaseStatusSchema = z.object({
  status: z.enum(CASE_STATUS),
  note: z.string().trim().max(1000).optional(),
})

export const CaseRequirementSchema = z.object({
  requirement: z.string().trim().min(1, 'Requirement is required').max(300),
  source: z.enum(['checklist', 'carrier', 'manual']).default('manual'),
})

export const RequirementPatchSchema = z.object({
  status: z.enum(['outstanding', 'received', 'waived', 'complete']),
})

// ─── Commission (OS-11 / WF-7) ──────────────────────────────────────────────────
export const CommissionSplitSchema = z
  .object({
    product_family: z.enum(PRODUCT_FAMILY),
    agency_id: uuid.optional().or(z.literal('').transform(() => undefined)),
    fsa_split_pct: z.coerce.number().min(0).max(100),
    agency_split_pct: z.coerce.number().min(0).max(100),
    note: z.string().trim().max(300).optional(),
  })
  .refine((v) => Math.abs(v.fsa_split_pct + v.agency_split_pct - 100) < 0.001, {
    message: 'Splits must sum to 100%',
    path: ['agency_split_pct'],
  })
export type CommissionSplit = z.infer<typeof CommissionSplitSchema>

export const CommissionReceiptSchema = z.object({
  commission_id: uuid,
  amount: z.coerce.number().min(0),
  period: z.string().trim().max(40).optional(),
  paid_on: isoDate.optional().or(z.literal('').transform(() => undefined)),
  is_trail: z.boolean().default(false),
})

export const CommissionAdjustmentSchema = z.object({
  commission_id: uuid,
  amount: z.coerce.number(), // negative allowed (chargeback)
  kind: z.enum(['adjustment', 'chargeback']).default('adjustment'),
  reason: z.string().trim().min(1, 'A reason is required for every adjustment').max(500),
})

// ─── Legacy-port config (GDC tiers + FFS contacts) ──────────────────────────────
// GDC tier thresholds/payouts are assumption-flagged config DEFAULTS, never a
// Farmers-published figure (guardrail §2.3). Upsert keyed by tier_no.
export const GdcTierSchema = z
  .object({
    tier_no: z.coerce.number().int().min(1).max(20),
    label: z.string().trim().min(1, 'Label is required').max(60),
    min_gdc: z.coerce.number().min(0),
    // Blank ceiling = open-ended top tier.
    max_gdc: z.coerce.number().min(0).optional().or(z.literal('').transform(() => undefined)),
    payout_pct: z.coerce.number().min(0).max(100),
    note: z.string().trim().max(300).optional(),
  })
  .refine((v) => v.max_gdc === undefined || v.max_gdc >= v.min_gdc, {
    message: 'Ceiling must be ≥ floor',
    path: ['max_gdc'],
  })
export type GdcTierInput = z.infer<typeof GdcTierSchema>

// FFS key contacts — config-driven quick-access directory. `id` present = update.
export const FfsContactSchema = z.object({
  id: uuid.optional().or(z.literal('').transform(() => undefined)),
  role: z.string().trim().min(1, 'Role is required').max(120),
  name: z.string().trim().max(120).optional().or(z.literal('').transform(() => undefined)),
  phone: z
    .string()
    .trim()
    .min(7, 'Enter a valid phone')
    .max(40)
    .regex(/^[0-9+().\-\s]+$/, 'Digits and + ( ) - only'),
  hours: z.string().trim().max(80).optional().or(z.literal('').transform(() => undefined)),
  note: z.string().trim().max(120).optional().or(z.literal('').transform(() => undefined)),
  sort: z.coerce.number().int().min(0).max(999).default(0),
  active: z.boolean().optional(),
})
export type FfsContactInput = z.infer<typeof FfsContactSchema>

// ─── Marketing & Comms (OS-12 / WF-5) ───────────────────────────────────────────
export const TEMPLATE_CATEGORY = [
  'appointment',
  'referral',
  'agency',
  'term_conversion',
  'policy_review',
  'event',
  'educational',
] as const

export const TemplateCreateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(160),
  channel: z.enum(['sms', 'email']),
  category: z.enum(TEMPLATE_CATEGORY),
  body: z.string().trim().min(1, 'Body is required').max(4000),
})
export type TemplateCreate = z.infer<typeof TemplateCreateSchema>

export const TemplatePatchSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    body: z.string().trim().min(1).max(4000).optional(),
    category: z.enum(TEMPLATE_CATEGORY).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'No fields to update')

export const TemplateApprovalSchema = z.object({
  action: z.enum(['submit', 'approve', 'reject']),
})

export const CampaignCreateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(160),
  channel: z.enum(['sms', 'email']),
  category: z.enum(TEMPLATE_CATEGORY),
  template_id: uuid,
  // audience selection — a segment definition; the dispatch job re-checks the gate per recipient.
  audience: z
    .object({
      kind: z.enum(['all_consented', 'household_ids', 'cross_sell', 'conversion']).default('all_consented'),
      household_ids: z.array(uuid).max(5000).optional(),
    })
    .default({ kind: 'all_consented' }),
  schedule_at: z.string().datetime().optional().or(z.literal('').transform(() => undefined)),
  quiet_hours_ack: z.boolean(),
})
export type CampaignCreate = z.infer<typeof CampaignCreateSchema>

// ─── Documents (OS-13) ──────────────────────────────────────────────────────────
export const DocumentRequestSchema = z.object({
  household_id: uuid,
  case_id: uuid.optional().or(z.literal('').transform(() => undefined)),
  requirement: z.string().trim().min(1, 'Requirement is required').max(300),
})

// ─── Incidents (OS / WF-10) ─────────────────────────────────────────────────────
export const IncidentCreateSchema = z.object({
  scope: z.string().trim().min(1, 'Scope is required').max(300),
  data_types: z.string().trim().max(300).optional(),
  affected_count: z.coerce.number().int().min(0).optional(),
})
export const IncidentStepSchema = z.object({
  status: z.enum(['open', 'assessing', 'notifying', 'closed']),
  note: z.string().trim().max(1000).optional(),
})

// ═══════════════════════════════════════════════════════════════════════════════
// P2 (operational enhancement) input schemas. Every P2 API write validates here;
// no P2 form or route weakens a P0/P1 guardrail.
// ═══════════════════════════════════════════════════════════════════════════════

// ─── OS-14 Automation workflows (builder: triggers/conditions/delays/branching) ──
export const WORKFLOW_TRIGGERS = [
  'manual', 'referral_received', 'review_completed', 'opportunity_stage',
  'policy_x_date', 'case_status', 'schedule', 'conversion_window',
] as const
const WorkflowConditionSchema = z.object({
  field: z.string().trim().min(1).max(80),
  op: z.enum(['eq', 'neq', 'gt', 'lt', 'contains', 'exists']),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
})
const WorkflowStepSchema = z.object({
  type: z.enum(['action', 'delay', 'branch']),
  // action: create task / log activity / enqueue comm (comm still passes the gate).
  action: z.enum(['create_task', 'log_activity', 'enqueue_sequence', 'notify_fsa']).optional(),
  delay_hours: z.coerce.number().int().min(0).max(8760).optional(),
  config: z.record(z.unknown()).default({}),
})
export const WorkflowCreateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(160),
  description: z.string().trim().max(1000).optional(),
  trigger_type: z.enum(WORKFLOW_TRIGGERS).default('manual'),
  trigger_config: z.record(z.unknown()).default({}),
  conditions: z.array(WorkflowConditionSchema).max(20).default([]),
  steps: z.array(WorkflowStepSchema).max(30).default([]),
  failure_policy: z
    .object({
      max_retries: z.coerce.number().int().min(0).max(10).default(3),
      backoff: z.enum(['fixed', 'exponential']).default('exponential'),
    })
    .default({ max_retries: 3, backoff: 'exponential' }),
})
export type WorkflowCreate = z.infer<typeof WorkflowCreateSchema>
export const WorkflowPatchSchema = z.object({
  enabled: z.boolean().optional(),
  archived: z.boolean().optional(),
}).refine((v) => Object.keys(v).length > 0, 'No fields to update')

// ─── OS-13 Comms — sequences + audience builder ──────────────────────────────────
export const SequenceCreateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(160),
  description: z.string().trim().max(1000).optional(),
  channel: z.enum(['email', 'sms']).default('email'),
  category: z.string().trim().max(60).optional(),
  steps: z
    .array(
      z.object({
        delay_days: z.coerce.number().int().min(0).max(365),
        template_id: uuid.optional(),
        subject: z.string().trim().max(200).optional(),
      }),
    )
    .max(20)
    .default([]),
})
export type SequenceCreate = z.infer<typeof SequenceCreateSchema>

export const AudienceCreateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(160),
  description: z.string().trim().max(1000).optional(),
  definition: z
    .object({
      base: z.enum(['households', 'agencies', 'policies']).default('households'),
      has_life: z.enum(['any', 'yes', 'no']).default('any'),
      status: z.string().trim().max(40).optional(),
      consented_only: z.boolean().default(true),
    })
    .default({ base: 'households', has_life: 'any', consented_only: true }),
})
export type AudienceCreate = z.infer<typeof AudienceCreateSchema>

// ─── OS-16 Reports — builder + scheduled ─────────────────────────────────────────
export const REPORT_SOURCES = [
  'pipeline', 'commission-by-agency', 'conversion', 'cross-sell', 'production',
  'agency-leaderboard', 'referral-analytics',
] as const
export const ReportDefinitionSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(160),
  description: z.string().trim().max(1000).optional(),
  source_key: z.enum(REPORT_SOURCES),
  columns: z.array(z.string().trim().max(60)).max(40).default([]),
  filters: z.record(z.unknown()).default({}),
})
export type ReportDefinition = z.infer<typeof ReportDefinitionSchema>
export const ScheduledReportSchema = z.object({
  report_key: z.enum(REPORT_SOURCES),
  name: z.string().trim().min(1, 'Name is required').max(160),
  cadence: z.enum(['daily', 'weekly', 'monthly']).default('weekly'),
  format: z.enum(['csv', 'pdf']).default('csv'),
  recipients: z.array(z.string().trim().email()).max(20).default([]),
})
export type ScheduledReport = z.infer<typeof ScheduledReportSchema>

// ─── Compliance (P-3) — legal holds, attestations, policies ──────────────────────
export const LegalHoldSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(160),
  matter_ref: z.string().trim().max(120).optional(),
  reason: z.string().trim().min(1, 'Reason is required').max(1000),
  scope: z
    .object({
      entity_type: z.enum(['household', 'agency', 'case', 'document']),
      entity_ids: z.array(uuid).max(2000).default([]),
    })
    .optional(),
})
export type LegalHold = z.infer<typeof LegalHoldSchema>
export const LegalHoldReleaseSchema = z.object({ action: z.literal('release') })

export const AttestationSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
  body: z.string().trim().min(1, 'Body is required').max(5000),
  period: z.string().trim().max(40).optional(),
  required_roles: z.array(z.string().trim().max(40)).max(12).default([]),
  due_at: z.string().datetime().optional().or(z.literal('').transform(() => undefined)),
})
export type Attestation = z.infer<typeof AttestationSchema>
export const AttestationAckSchema = z.object({
  response: z.string().trim().max(1000).optional(),
})

export const CompliancePolicySchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
  category: z.string().trim().max(60).optional(),
  body: z.string().trim().max(20000).default(''),
})
export type CompliancePolicy = z.infer<typeof CompliancePolicySchema>
export const CompliancePolicyActionSchema = z.object({
  action: z.enum(['publish', 'retire']),
})

// ─── Admin — data exports ────────────────────────────────────────────────────────
export const EXPORT_DATASETS = [
  'agencies', 'households', 'policies', 'opportunities', 'cases', 'commissions', 'referrals',
] as const
export const DataExportSchema = z.object({
  dataset: z.enum(EXPORT_DATASETS),
  format: z.enum(['csv', 'json']).default('csv'),
  notes: z.string().trim().max(500).optional(),
})
export type DataExport = z.infer<typeof DataExportSchema>

// ─── Partner training ────────────────────────────────────────────────────────────
export const TrainingCompleteSchema = z.object({
  training_id: uuid,
})

// ─── Super — AI sandbox + webhooks ───────────────────────────────────────────────
export const SandboxRunSchema = z.object({
  agent_key: z.string().trim().max(80).optional(),
  prompt: z.string().trim().min(1, 'Prompt is required').max(8000),
})
export type SandboxRun = z.infer<typeof SandboxRunSchema>

export const WEBHOOK_EVENTS = [
  'referral.received', 'opportunity.stage_changed', 'case.status_changed',
  'commission.recorded', 'review.completed', 'compliance.escalation',
] as const
export const WebhookCreateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(160),
  target_url: z.string().trim().url('Enter a valid https URL').max(500),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1, 'Select at least one event').max(WEBHOOK_EVENTS.length),
  secret: z.string().trim().max(200).optional(),
})
export type WebhookCreate = z.infer<typeof WebhookCreateSchema>
export const WebhookPatchSchema = z.object({
  enabled: z.boolean(),
})

// ─── P3 (Phase 4) — custom dashboards + advanced forecasting ─────────────────────
// A dashboard's layout is an ordered list of widget keys from the analytics catalog
// (lib/analytics/catalog.ts). Every widget renders from a DB-derived metric — the
// layout only pins WHICH widgets, in WHAT order, so a dashboard can't drift.
export const DASHBOARD_WIDGET_KEYS = [
  'agency_partnerships', 'open_opportunities', 'households', 'policies',
  'referrals_awaiting', 'ai_escalations', 'overdue_tasks', 'conversions_due',
  'cross_sell_targets', 'expected_commission_open', 'weighted_pipeline', 'commission_ytd',
] as const
export const DashboardCreateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(160),
  description: z.string().trim().max(1000).optional(),
  visibility: z.enum(['private', 'shared']).default('private'),
  layout: z.array(z.enum(DASHBOARD_WIDGET_KEYS)).min(1, 'Add at least one widget').max(24),
})
export type DashboardCreate = z.infer<typeof DashboardCreateSchema>
export const DashboardPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    description: z.string().trim().max(1000).optional(),
    visibility: z.enum(['private', 'shared']).optional(),
    layout: z.array(z.enum(DASHBOARD_WIDGET_KEYS)).min(1).max(24).optional(),
    archived: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No changes provided' })
export type DashboardPatch = z.infer<typeof DashboardPatchSchema>

// Per-user PERSONAL dashboard layout (migration 020). One placed widget = a catalog
// key plus its grid position (x,y), size (w,h), and visibility. The layout only pins
// which widgets are shown and where/how big — never any figure — so it can't drift.
export const DashboardWidgetPlacementSchema = z.object({
  key: z.enum(DASHBOARD_WIDGET_KEYS),
  x: z.number().int().min(0).max(11),
  y: z.number().int().min(0).max(200),
  w: z.number().int().min(1).max(12),
  h: z.number().int().min(1).max(8),
  visible: z.boolean().default(true),
})
export type DashboardWidgetPlacement = z.infer<typeof DashboardWidgetPlacementSchema>

export const DashboardPreferencesSchema = z.object({
  // At most one placement per widget; empty array is allowed (user hid everything).
  layout: z.array(DashboardWidgetPlacementSchema).max(48),
})
export type DashboardPreferences = z.infer<typeof DashboardPreferencesSchema>

// Advanced-forecasting assumptions. Stage → close-probability is an editable config
// DEFAULT (is_assumption), never a Farmers-published figure (guardrail §2.3).
export const FORECAST_STAGE_KEYS = [
  'prospect', 'fact_find', 'quoted_proposed', 'application', 'underwriting_suitability',
] as const
export const ForecastSettingsSchema = z.object({
  probabilities: z.record(z.enum(FORECAST_STAGE_KEYS), z.number().min(0).max(1)),
  horizon_months: z.number().int().min(1).max(24).default(3),
})
export type ForecastSettings = z.infer<typeof ForecastSettingsSchema>

// ─── Client Forms (legacy-port §2.3) ───────────────────────────────────────────
// Public intake envelope. `answers` is the free-form template field payload; the
// envelope (name/email/consent) is what the firewall + comms gate care about.
// No securities field is accepted on any public form (guardrail §2.1).
const answerValue = z.union([z.string().max(5000), z.number(), z.boolean()])
export const FormPublicSubmitSchema = z.object({
  template_slug: z.string().trim().min(1, 'Missing form').max(120),
  token: z.string().trim().max(200).optional(),
  full_name: z.string().trim().min(1, 'Your name is required').max(200),
  email: z.string().trim().email('Enter a valid email').max(200),
  phone: optionalPhone,
  answers: z.record(z.string().max(120), answerValue).default({}),
  consent_sms: z.boolean().optional().default(false),
  consent_email: z.boolean().optional().default(false),
})
export type FormPublicSubmit = z.infer<typeof FormPublicSubmitSchema>

// Attach a submitted response to a household (internal, licensed staff).
export const FormAttachSchema = z.object({ household_id: uuid })
export type FormAttach = z.infer<typeof FormAttachSchema>

// ─── Workshops (legacy-port §2.5) ──────────────────────────────────────────────
export const WORKSHOP_TOPICS = ['retirement', 'life', 'business', 'general', 'education'] as const
export const WORKSHOP_STATUS = ['draft', 'published', 'completed', 'cancelled'] as const

export const WorkshopCreateSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
  topic: z.enum(WORKSHOP_TOPICS),
  description: z.string().trim().max(2000).optional(),
  scheduled_at: z.string().datetime({ message: 'Pick a date & time' }).or(
    z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Pick a date & time'),
  ),
  location: z.string().trim().max(300).optional(),
  max_attendees: z.coerce.number().int().min(1).max(100000).optional(),
})
export type WorkshopCreate = z.infer<typeof WorkshopCreateSchema>

export const WorkshopPatchSchema = z
  .object({
    status: z.enum(WORKSHOP_STATUS).optional(),
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).optional(),
    location: z.string().trim().max(300).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No changes provided' })
export type WorkshopPatch = z.infer<typeof WorkshopPatchSchema>

// Public workshop registration. Consent captured at registration (§2.5). No
// securities data. Honeypot handled before Zod in the route.
export const WorkshopRegisterSchema = z.object({
  workshop_id: uuid,
  name: z.string().trim().min(1, 'Your name is required').max(160),
  email: z.string().trim().email('Enter a valid email').max(200),
  phone: optionalPhone,
  consent_email: z.boolean().optional().default(false),
  consent_sms: z.boolean().optional().default(false),
})
export type WorkshopRegister = z.infer<typeof WorkshopRegisterSchema>

// Internal registration update: mark attendance and/or convert to a referral.
export const RegistrationPatchSchema = z
  .object({
    attended: z.boolean().optional(),
    convert_to_referral: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No changes provided' })
export type RegistrationPatch = z.infer<typeof RegistrationPatchSchema>

// ─── OPRA Transfer Center (App A → App B parity) ───────────────────────────────
// One-policy households eligible for an OPRA transfer/review. Status toggles are
// manual FSA actions (mark contacted / appointment / review / transferred) — not
// automated client sends — so there is no green-zone verb here; the securities
// firewall still surfaces is_security records read-only in the UI.
export const OPRA_STATUS = ['identified', 'contacted', 'scheduled', 'reviewed', 'transferred', 'declined'] as const

// Create a tracked OPRA case from an eligible household (+ its single policy).
export const OpraTrackSchema = z.object({
  household_id: uuid,
  policy_id: uuid.optional(),
})
export type OpraTrack = z.infer<typeof OpraTrackSchema>

// Update the status flags on a tracked case. Every field optional; at least one
// change required. Timestamps are stamped server-side when a flag flips.
export const OpraStatusSchema = z
  .object({
    contacted: z.boolean().optional(),
    appt_scheduled: z.boolean().optional(),
    appt_date: isoDate.optional(),
    review_complete: z.boolean().optional(),
    review_date: isoDate.optional(),
    transferred: z.boolean().optional(),
    status: z.enum(OPRA_STATUS).optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No changes provided' })
export type OpraStatus = z.infer<typeof OpraStatusSchema>

// ─── Native GoHighLevel sync (App A → App B parity) ────────────────────────────
// Push an App B record into GoHighLevel (idempotent; returned GHL ids stored back
// on the record). Two entity modes map to the two legacy sync modes:
//   household → prospect_client pipeline · agency → agency_owner pipeline.
export const GHL_SYNC_ENTITY = ['household', 'agency'] as const
export const GHL_PIPELINE_KEY = ['prospect_client', 'agency_owner', 'term_conversions'] as const

export const GhlSyncSchema = z.object({
  entity_type: z.enum(GHL_SYNC_ENTITY),
  entity_id: uuid,
  pipeline: z.enum(GHL_PIPELINE_KEY).optional(),
  stage: z.number().int().min(1).max(20).optional(),
  tags: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
})
export type GhlSync = z.infer<typeof GhlSyncSchema>
