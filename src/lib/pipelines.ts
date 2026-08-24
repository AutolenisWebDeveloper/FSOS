// src/lib/pipelines.ts
// ─────────────────────────────────────────────────────────────────────────
// FSOS-native pipeline + stage taxonomy.
//
// This is the provider-neutral catalog of FSOS's sales/service pipelines and
// their stages: the stage names, positions, the internal-pipeline mapping used
// by commission_cases.pipeline and scoring, and the "application submitted" /
// "issued" lifecycle markers. It was formerly co-located with the GoHighLevel
// integration adapter, but the taxonomy itself is an internal business concept
// FSOS owns independently of any external provider (GHL excised — Pre-Phase-2).
//
// Stage `id` values are the canonical, opaque stage identifiers of record. They
// remain stable so historical rows that stored a stage id still resolve to the
// correct human-readable stage/pipeline through findStageById().
// ─────────────────────────────────────────────────────────────────────────

// Internal pipeline taxonomy used by commission_cases.pipeline and scoring.
export type InternalPipeline =
  | 'general'
  | 'owner'
  | 'conversions'
  | 'opra'
  | 'life'
  | 'retirement'
  | 'business'

/** The three FSOS pipeline keys. */
export type PipelineKey = 'prospect_client' | 'agency_owner' | 'term_conversions'

export interface PipelineStage {
  id: string
  name: string
  position: number
}

export interface Pipeline {
  id: string
  name: string
  key: PipelineKey
  internal: InternalPipeline
  stages: PipelineStage[]
}

// ── Pipeline A — Prospect / Client ───────────────────────────────────────
export const PIPELINE_PROSPECT_CLIENT: Pipeline = {
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
export const PIPELINE_AGENCY_OWNER: Pipeline = {
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
export const PIPELINE_TERM_CONVERSIONS: Pipeline = {
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

export const PIPELINES: Pipeline[] = [
  PIPELINE_PROSPECT_CLIENT,
  PIPELINE_AGENCY_OWNER,
  PIPELINE_TERM_CONVERSIONS,
]

// ── Reverse lookups ──────────────────────────────────────────────────────

export interface StageLocation {
  stageId: string
  stageName: string
  position: number
  pipeline: Pipeline
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

const PIPELINE_BY_ID: Map<string, Pipeline> = new Map(PIPELINES.map((p) => [p.id, p]))

export function findStageById(stageId: string | null | undefined): StageLocation | null {
  if (!stageId) return null
  return STAGE_INDEX.get(stageId) || null
}

export function findPipelineById(pipelineId: string | null | undefined): Pipeline | null {
  if (!pipelineId) return null
  return PIPELINE_BY_ID.get(pipelineId) || null
}

/** Resolve a stage by pipeline key + 1-based position (used by stage-move actions). */
export function stageAt(pipelineKey: PipelineKey, position: number): PipelineStage | null {
  const pipeline = PIPELINES.find((p) => p.key === pipelineKey)
  if (!pipeline) return null
  return pipeline.stages.find((s) => s.position === position) || null
}

// Stages that mean "an application was submitted".
export const APPLICATION_SUBMITTED_STAGE_IDS = new Set<string>([
  'f7be8411-c27e-4d67-9a73-5f4b048425ee', // Pipeline A · Application Submitted
  '971271bb-8710-4a49-8e0d-f66cd6b899d5', // Pipeline C · Application Submitted
])

// Stages that mean "issued / converted".
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

/**
 * Compact pipeline/stage display object attached to a read model. Resolves the
 * human-readable stage/pipeline from a stored stage id via the ID map.
 *
 * DORMANT READ (GHL excision, Pre-Phase-2): the historical stage/opportunity ids
 * were populated by the now-removed GoHighLevel sync and live on the legacy
 * `ghl_*` columns (retained as dormant schema). No application behavior branches
 * on this output — it is a display-only read model — so these historical reads
 * create no runtime provider dependency. A NULL/absent value simply yields the
 * empty summary below. The output keys are kept stable for existing UI readers.
 */
export interface PipelineSummary {
  in_ghl: boolean
  stage: string | null
  stage_position: number | null
  pipeline: string | null
  pipeline_key: PipelineKey | null
  opportunity_id: string | null
}

export function pipelineSummary(
  row:
    | { ghl_stage_id?: string | null; ghl_contact_id?: string | null; ghl_opportunity_id?: string | null }
    | null
    | undefined,
): PipelineSummary {
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
