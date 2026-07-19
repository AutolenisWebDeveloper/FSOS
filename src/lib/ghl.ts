// src/lib/ghl.ts
// ─────────────────────────────────────────────────────────────────────────
// GoHighLevel integration surface for FSOS.
//
// This module is the single source of truth for the GHL account wiring:
//   • the authoritative Pipeline + Stage ID map (the binding contract that
//     every stage-move action and the webhook parser depend on),
//   • the custom-field key map,
//   • a thin, fully-guarded REST client (no-ops when env is unset so the rest
//     of the app keeps working without GHL configured).
//
// Location: Markist Athelus Agency — ATDNO1e5d27nj5t8vId3
// Verified live against the account on 2026-07-08.
// ─────────────────────────────────────────────────────────────────────────

export const GHL_LOCATION_ID_DEFAULT = 'ATDNO1e5d27nj5t8vId3'

// Internal pipeline taxonomy used by commission_cases.pipeline and scoring.
export type InternalPipeline =
  | 'general'
  | 'owner'
  | 'conversions'
  | 'opra'
  | 'life'
  | 'retirement'
  | 'business'

export interface GhlStage {
  id: string
  name: string
  position: number
}

export interface GhlPipeline {
  id: string
  name: string
  key: 'prospect_client' | 'agency_owner' | 'term_conversions'
  internal: InternalPipeline
  stages: GhlStage[]
}

// ── Pipeline A — Prospect / Client ───────────────────────────────────────
export const PIPELINE_PROSPECT_CLIENT: GhlPipeline = {
  id: 'nuOBjRl27uhinHChdqfH',
  name: 'Prospect / Client',
  key: 'prospect_client',
  internal: 'general',
  stages: [
    { position: 1, name: 'New Opportunity', id: '8681cb03-c6d6-4803-8227-2ac4802f4bf4' },
    { position: 2, name: 'Contacted', id: '9f50bd51-bb1a-4f38-a891-e51f593c3588' },
    { position: 3, name: 'Appointment Scheduled', id: 'a66eee40-cac1-47e1-8365-1266074eb63a' },
    { position: 4, name: 'Appointment Completed', id: 'e6b0b2d6-25dc-43a4-b687-c83c946e0371' },
    { position: 5, name: 'Fact-Finder Completed', id: 'a7d8efda-3bbb-4a39-8a56-a3e0e2290fd1' },
    { position: 6, name: 'Recommendation Presented', id: '668c6a07-83ca-48db-8e33-7f4193b1ae8f' },
    { position: 7, name: 'Application Submitted', id: 'f7be8411-c27e-4d67-9a73-5f4b048425ee' },
    { position: 8, name: 'Issued', id: '663763b9-b082-47d8-8c82-67342d49a823' },
    { position: 9, name: 'Annual Review Scheduled', id: '2bd09d9f-5a60-42b7-aa39-bc48dee37db1' },
    { position: 10, name: 'Referral Requested', id: '9a62ed59-8586-4d39-9886-63dc6ecaa49e' },
  ],
}

// ── Pipeline B — Agency Owner ────────────────────────────────────────────
export const PIPELINE_AGENCY_OWNER: GhlPipeline = {
  id: 'lIUaJLNxFwtCJPycw70h',
  name: 'Agency Owner',
  key: 'agency_owner',
  internal: 'owner',
  stages: [
    { position: 1, name: 'Prospect Owner', id: '6304e715-90dc-43d3-a764-31424c861b28' },
    { position: 2, name: 'Pilot (90-day)', id: '48a460db-7229-4159-9a96-05813ede66af' },
    { position: 3, name: 'Active Partner', id: '2b592b9d-8650-41ec-8a09-6f5f1b472700' },
    { position: 4, name: 'Opportunity Handoff', id: 'abe55df8-4e1e-4833-b11f-2bd18ab2f0f8' },
    { position: 5, name: 'Financial Assessment', id: 'ec067c76-e905-4c89-b352-ed6d85e566ba' },
    { position: 6, name: 'Quick Wins', id: '51c0290e-2ebe-42af-98d5-993cfa79a0de' },
    { position: 7, name: 'Strategic Partner', id: '211e1646-b215-40a2-bcfb-601006db3763' },
    { position: 8, name: 'Dormant', id: '5077ae1f-5149-4f7d-ba39-2772edcb33f9' },
  ],
}

// ── Pipeline C — Term Conversions ────────────────────────────────────────
export const PIPELINE_TERM_CONVERSIONS: GhlPipeline = {
  id: 'EGvOhkgRjUslNVXGX1Wp',
  name: 'Term Conversions',
  key: 'term_conversions',
  internal: 'conversions',
  stages: [
    { position: 1, name: 'Conversion Eligible Identified', id: 'af3e3e02-30b8-4dd0-bbc5-7dcd6a59c4b8' },
    { position: 2, name: 'Window Notice Sent', id: 'bd03e1cb-88de-4ccc-9b87-23ba33579545' },
    { position: 3, name: 'Review Scheduled', id: '0bebd4f9-2091-48ad-8d0b-5842b3d3cc5e' },
    { position: 4, name: 'Conversion Illustrated', id: '7a638d86-7302-4072-90e9-24ae8249dc30' },
    { position: 5, name: 'Application Submitted', id: '971271bb-8710-4a49-8e0d-f66cd6b899d5' },
    { position: 6, name: 'Converted (Issued)', id: 'c718945e-f219-4b71-aae4-02b0d513f489' },
  ],
}

export const PIPELINES: GhlPipeline[] = [
  PIPELINE_PROSPECT_CLIENT,
  PIPELINE_AGENCY_OWNER,
  PIPELINE_TERM_CONVERSIONS,
]

// Pre-existing "Investment Marketing Pipeline" (yTS0xcoKpCEZldhHQ2tM) is
// intentionally NOT modeled here — it is out of scope for FSOS.

// ── Reverse lookups ──────────────────────────────────────────────────────

export interface StageLocation {
  stageId: string
  stageName: string
  position: number
  pipeline: GhlPipeline
}

const STAGE_INDEX: Map<string, StageLocation> = (() => {
  const m = new Map<string, StageLocation>()
  for (const pipeline of PIPELINES) {
    for (const s of pipeline.stages) {
      m.set(s.id, { stageId: s.id, stageName: s.name, position: s.position, pipeline })
    }
  }
  return m
})()

const PIPELINE_BY_ID: Map<string, GhlPipeline> = new Map(PIPELINES.map((p) => [p.id, p]))

export function findStageById(stageId: string | null | undefined): StageLocation | null {
  if (!stageId) return null
  return STAGE_INDEX.get(stageId) || null
}

export function findPipelineById(pipelineId: string | null | undefined): GhlPipeline | null {
  if (!pipelineId) return null
  return PIPELINE_BY_ID.get(pipelineId) || null
}

/** Resolve a stage by pipeline key + 1-based position (used by stage-move actions). */
export function stageAt(pipelineKey: GhlPipeline['key'], position: number): GhlStage | null {
  const pipeline = PIPELINES.find((p) => p.key === pipelineKey)
  if (!pipeline) return null
  return pipeline.stages.find((s) => s.position === position) || null
}

// Stages that mean "an application was submitted" — trigger commission-case create.
export const APPLICATION_SUBMITTED_STAGE_IDS = new Set<string>([
  'f7be8411-c27e-4d67-9a73-5f4b048425ee', // Pipeline A · Application Submitted
  '971271bb-8710-4a49-8e0d-f66cd6b899d5', // Pipeline C · Application Submitted
])

// Stages that mean "issued / converted" — mark the case issued.
export const ISSUED_STAGE_IDS = new Set<string>([
  '663763b9-b082-47d8-8c82-67342d49a823', // Pipeline A · Issued
  'c718945e-f219-4b71-aae4-02b0d513f489', // Pipeline C · Converted (Issued)
])

export function isApplicationSubmittedStage(stageId: string | null | undefined): boolean {
  return !!stageId && APPLICATION_SUBMITTED_STAGE_IDS.has(stageId)
}

export function isIssuedStage(stageId: string | null | undefined): boolean {
  return !!stageId && ISSUED_STAGE_IDS.has(stageId)
}

export interface GhlSummary {
  in_ghl: boolean
  stage: string | null
  stage_position: number | null
  pipeline: string | null
  pipeline_key: GhlPipeline['key'] | null
  opportunity_id: string | null
}

// Build the compact GHL display object the read APIs attach to a row. Resolves
// the human-readable stage/pipeline from the stored stage id via the ID map.
export function ghlSummary(
  row:
    | { ghl_stage_id?: string | null; ghl_contact_id?: string | null; ghl_opportunity_id?: string | null }
    | null
    | undefined,
): GhlSummary {
  const loc = findStageById(row?.ghl_stage_id)
  if (loc) {
    return {
      in_ghl: true,
      stage: loc.stageName,
      stage_position: loc.position,
      pipeline: loc.pipeline.name,
      pipeline_key: loc.pipeline.key,
      opportunity_id: row?.ghl_opportunity_id || null,
    }
  }
  return {
    in_ghl: !!row?.ghl_contact_id,
    stage: null,
    stage_position: null,
    pipeline: null,
    pipeline_key: null,
    opportunity_id: row?.ghl_opportunity_id || null,
  }
}

// ── Custom-field key map (contact model) ─────────────────────────────────
// Keys as they appear in GHL (contact.<key>). Used when reading/writing
// custom fields via the API.
export const GHL_CUSTOM_FIELDS = {
  lead_source: 'lead_source',
  referring_owner: 'referring_agency_owner',
  owner_agency: 'owner_agency_name',
  contact_type: 'contact_type',
  life_stage: 'life_stage',
  product_interest: 'product_interest',
  lead_score: 'lead_score',
  sms_consent: 'sms_consent',
  sms_consent_date: 'sms_consent_date',
  email_consent: 'email_consent',
  contact_tz: 'contact_timezone',
  appt_outcome: 'appointment_outcome',
  anniversary_date: 'anniversary_date',
  client_since: 'client_since',
  journey_year: 'journey_year',
  dnc_crosssell: 'do_not_crosssell',
  owner_status: 'partnership_status',
  owner_success_stage: 'owner_success_stage',
  owner_book_size: 'book_size_households',
  owner_refs_mtd: 'referrals_received_mtd',
  owner_appts_mtd: 'appointments_set_mtd',
  owner_closed_ytd: 'closed_count_ytd',
  owner_premium_ytd: 'premium_generated_ytd',
  owner_assets_id: 'owner_assets_id',
  owner_last_report: 'last_report_sent',
  // Term-conversion support fields
  term_conversion_eligible: 'term_conversion_eligible',
  conversion_deadline: 'conversion_deadline',
  conversion_score: 'conversion_score',
  policy_type_life: 'policy_type_life',
  term_face_amount: 'term_face_amount',
} as const

// ── REST client (LeadConnector API v2) ───────────────────────────────────

const GHL_API_BASE = 'https://services.leadconnectorhq.com'
const GHL_API_VERSION = '2021-07-28'

export function ghlLocationId(): string {
  return process.env.GHL_LOCATION_ID || GHL_LOCATION_ID_DEFAULT
}

/** True when the app is configured to talk to GHL. When false, all writes no-op. */
export function ghlEnabled(): boolean {
  return !!process.env.GHL_API_KEY
}

interface GhlResult<T = unknown> {
  ok: boolean
  status: number
  data?: T
  error?: string
  skipped?: boolean
}

async function ghlFetch<T = unknown>(
  path: string,
  init: { method: string; body?: unknown },
): Promise<GhlResult<T>> {
  if (!ghlEnabled()) return { ok: false, status: 0, skipped: true, error: 'GHL not configured' }

  try {
    const res = await fetch(`${GHL_API_BASE}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${process.env.GHL_API_KEY}`,
        Version: GHL_API_VERSION,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    })

    const text = await res.text()
    let json: unknown = undefined
    try {
      json = text ? JSON.parse(text) : undefined
    } catch {
      /* non-JSON body */
    }

    if (!res.ok) {
      return { ok: false, status: res.status, data: json as T, error: text.slice(0, 500) }
    }
    return { ok: true, status: res.status, data: json as T }
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) }
  }
}

export interface UpsertContactInput {
  firstName?: string
  lastName?: string
  email?: string | null
  phone?: string | null
  tags?: string[]
  source?: string
  // custom fields as { key: value } using GHL_CUSTOM_FIELDS keys
  customFields?: Record<string, string | number>
}

/** Upsert a contact (dedupes on email/phone per the location settings). */
export async function upsertContact(
  input: UpsertContactInput,
): Promise<GhlResult<{ contact?: { id?: string } }>> {
  const customField = input.customFields
    ? Object.entries(input.customFields).map(([key, value]) => ({ key, field_value: value }))
    : undefined

  const body: Record<string, unknown> = {
    locationId: ghlLocationId(),
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email || undefined,
    phone: input.phone || undefined,
    tags: input.tags,
    source: input.source,
  }
  if (customField) body.customFields = customField

  return ghlFetch('/contacts/upsert', { method: 'POST', body })
}

/**
 * Retry a GHL call on *transient* failures only: network errors (status 0),
 * rate limits (429), and 5xx. Client errors (4xx validation) are returned
 * immediately — retrying them just wastes the location's rate budget.
 * Backoff is deterministic (250ms, 500ms, 1000ms…) so it is test-friendly.
 */
export async function withGhlRetry<T>(
  fn: () => Promise<GhlResult<T>>,
  opts: { attempts?: number; baseDelayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<GhlResult<T> & { attempts: number }> {
  const attempts = Math.max(1, opts.attempts ?? 3)
  const base = opts.baseDelayMs ?? 250
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))

  let last: GhlResult<T> = { ok: false, status: 0, error: 'not attempted' }
  for (let n = 1; n <= attempts; n++) {
    last = await fn()
    if (last.ok || last.skipped) return { ...last, attempts: n }
    const transient = last.status === 0 || last.status === 429 || last.status >= 500
    if (!transient || n === attempts) return { ...last, attempts: n }
    await sleep(base * 2 ** (n - 1))
  }
  return { ...last, attempts }
}

/** Upsert a contact with transient-failure retry. Reports whether GHL treated it as new. */
export async function upsertContactWithRetry(
  input: UpsertContactInput,
  opts?: { attempts?: number; sleep?: (ms: number) => Promise<void> },
): Promise<GhlResult<{ contact?: { id?: string }; new?: boolean }> & { attempts: number }> {
  return withGhlRetry(() => upsertContact(input) as Promise<GhlResult<{ contact?: { id?: string }; new?: boolean }>>, opts)
}

export interface CreateOpportunityInput {
  contactId: string
  pipelineKey: GhlPipeline['key']
  stagePosition: number
  name: string
  monetaryValue?: number
  status?: 'open' | 'won' | 'lost' | 'abandoned'
}

/** Create an opportunity at a given pipeline stage (bound to the ID map). */
export async function createOpportunity(
  input: CreateOpportunityInput,
): Promise<GhlResult<{ opportunity?: { id?: string } }>> {
  const pipeline = PIPELINES.find((p) => p.key === input.pipelineKey)
  const stage = stageAt(input.pipelineKey, input.stagePosition)
  if (!pipeline || !stage) {
    return { ok: false, status: 0, error: `Unknown pipeline/stage: ${input.pipelineKey}#${input.stagePosition}` }
  }

  return ghlFetch('/opportunities/', {
    method: 'POST',
    body: {
      locationId: ghlLocationId(),
      contactId: input.contactId,
      pipelineId: pipeline.id,
      pipelineStageId: stage.id,
      name: input.name,
      status: input.status || 'open',
      monetaryValue: input.monetaryValue,
    },
  })
}

/** Move an existing opportunity to a stage (bound to the ID map). */
export async function moveOpportunityStage(
  opportunityId: string,
  pipelineKey: GhlPipeline['key'],
  stagePosition: number,
): Promise<GhlResult> {
  const stage = stageAt(pipelineKey, stagePosition)
  if (!stage) return { ok: false, status: 0, error: `Unknown stage: ${pipelineKey}#${stagePosition}` }
  return ghlFetch(`/opportunities/${opportunityId}`, {
    method: 'PUT',
    body: { pipelineStageId: stage.id },
  })
}

/** Add tags to a contact. */
export async function addContactTags(contactId: string, tags: string[]): Promise<GhlResult> {
  if (!tags.length) return { ok: true, status: 200 }
  return ghlFetch(`/contacts/${contactId}/tags`, { method: 'POST', body: { tags } })
}
