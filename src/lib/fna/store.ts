// src/lib/fna/store.ts
// FNA persistence service (ADR-016). The single write/read path for the structured
// FNA data model (fna_plans / fna_versions / fna_inputs / fna_assumption_sets /
// fna_results / fna_data_quality_exceptions). Routes stay thin: parse → authorize →
// call a service (CLAUDE.md §3.1). Uses getDb() (never a module-level client),
// pure lifecycle/conflict logic from plan-lifecycle.ts, and the engine's
// DEFAULT_ASSUMPTIONS as the seed/fallback assumption-set. Audit is written by the
// caller via writeAudit (the one append-only path) — kept out of the store so a
// single mutation isn't audited twice.

import { z } from 'zod'
import { getDb } from '@/lib/supabase/client'
import { DEFAULT_ASSUMPTIONS, ENGINE_VERSION, type AssumptionSet } from '@/lib/fna/engine'
import {
  canTransition,
  detectConflicts,
  nextVersionNo,
  type FnaStatus,
  type InputLike,
} from './plan-lifecycle'

export type StoreResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: 'not_found' | 'invalid_transition' | 'error'; message: string }

// ── Validation (Zod at the edge; no unvalidated write reaches the DB) ─────────
export const PlanTypeSchema = z.string().min(1).max(64)

export const FnaInputSchema = z.object({
  section: z.string().min(1).max(64),
  key: z.string().min(1).max(128),
  member_id: z.string().uuid().nullable().optional(),
  value_numeric: z.number().finite().nullable().optional(),
  value_text: z.string().max(2000).nullable().optional(),
  unit: z.string().max(32).nullable().optional(),
  source_label: z
    .enum([
      'verified',
      'client_supplied',
      'imported',
      'calculated',
      'estimated',
      'assumption_based',
      'incomplete',
      'unavailable',
      'needs_confirmation',
    ])
    .default('client_supplied'),
  source_record: z.string().max(256).nullable().optional(),
  effective_date: z.string().nullable().optional(),
  confidence: z.enum(['high', 'medium', 'low']).nullable().optional(),
  client_confirmed: z.boolean().optional(),
})
export type FnaInputWrite = z.infer<typeof FnaInputSchema>

export interface FnaPlanRow {
  id: string
  household_id: string
  review_id: string | null
  plan_type: string
  status: FnaStatus
  title: string | null
  current_version_id: string | null
  created_at: string
  updated_at: string
}

// ── Plans ────────────────────────────────────────────────────────────────────
export async function createPlan(
  householdId: string,
  planType: string,
  opts: { title?: string; reviewId?: string; actor: string },
): Promise<StoreResult<FnaPlanRow>> {
  const parsed = PlanTypeSchema.safeParse(planType)
  if (!parsed.success) return { ok: false, kind: 'error', message: 'invalid plan_type' }

  const db = getDb()
  const { data: hh, error: hhErr } = await db
    .from('households')
    .select('id')
    .eq('id', householdId)
    .is('deleted_at', null)
    .maybeSingle()
  if (hhErr) return { ok: false, kind: 'error', message: hhErr.message }
  if (!hh) return { ok: false, kind: 'not_found', message: 'Household not found' }

  const { data, error } = await db
    .from('fna_plans')
    .insert({
      household_id: householdId,
      plan_type: planType,
      title: opts.title ?? null,
      review_id: opts.reviewId ?? null,
      status: 'DRAFT',
      created_by: opts.actor,
      updated_by: opts.actor,
    })
    .select('id, household_id, review_id, plan_type, status, title, current_version_id, created_at, updated_at')
    .single()
  if (error) return { ok: false, kind: 'error', message: error.message }
  return { ok: true, data: data as FnaPlanRow }
}

export async function getPlan(id: string): Promise<StoreResult<FnaPlanRow>> {
  const { data, error } = await getDb()
    .from('fna_plans')
    .select('id, household_id, review_id, plan_type, status, title, current_version_id, created_at, updated_at')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) return { ok: false, kind: 'error', message: error.message }
  if (!data) return { ok: false, kind: 'not_found', message: 'Plan not found' }
  return { ok: true, data: data as FnaPlanRow }
}

export async function listPlans(filters: { householdId?: string; status?: FnaStatus } = {}): Promise<StoreResult<FnaPlanRow[]>> {
  let q = getDb()
    .from('fna_plans')
    .select('id, household_id, review_id, plan_type, status, title, current_version_id, created_at, updated_at')
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
  if (filters.householdId) q = q.eq('household_id', filters.householdId)
  if (filters.status) q = q.eq('status', filters.status)
  const { data, error } = await q
  if (error) return { ok: false, kind: 'error', message: error.message }
  return { ok: true, data: (data ?? []) as FnaPlanRow[] }
}

/** Transition a plan's status, enforcing the allowed state machine. */
export async function transitionPlanStatus(planId: string, to: FnaStatus, actor: string): Promise<StoreResult<FnaPlanRow>> {
  const current = await getPlan(planId)
  if (!current.ok) return current
  if (!canTransition(current.data.status, to)) {
    return { ok: false, kind: 'invalid_transition', message: `cannot move ${current.data.status} → ${to}` }
  }
  const { data, error } = await getDb()
    .from('fna_plans')
    .update({ status: to, updated_by: actor })
    .eq('id', planId)
    .select('id, household_id, review_id, plan_type, status, title, current_version_id, created_at, updated_at')
    .single()
  if (error) return { ok: false, kind: 'error', message: error.message }
  return { ok: true, data: data as FnaPlanRow }
}

// ── Inputs (+ conflict detection) ────────────────────────────────────────────
/**
 * Replace-append inputs for a plan and (re)compute conflict exceptions. Inputs are
 * additive rows (no uniqueness) so conflicting sources are preserved and surfaced;
 * this writes the supplied rows and refreshes the plan's conflict exceptions.
 */
export async function saveInputs(planId: string, inputs: FnaInputWrite[], actor: string): Promise<StoreResult<{ written: number; conflicts: number }>> {
  const db = getDb()
  const rows = inputs.map((i) => ({
    plan_id: planId,
    member_id: i.member_id ?? null,
    section: i.section,
    key: i.key,
    value_numeric: i.value_numeric ?? null,
    value_text: i.value_text ?? null,
    unit: i.unit ?? null,
    source_label: i.source_label ?? 'client_supplied',
    source_record: i.source_record ?? null,
    entered_by: actor,
    effective_date: i.effective_date ?? null,
    confidence: i.confidence ?? null,
    client_confirmed: i.client_confirmed ?? false,
  }))
  if (rows.length > 0) {
    const { error } = await db.from('fna_inputs').insert(rows)
    if (error) return { ok: false, kind: 'error', message: error.message }
  }

  // Recompute conflicts across ALL current inputs on the plan.
  const { data: allInputs, error: readErr } = await db
    .from('fna_inputs')
    .select('section, key, member_id, value_numeric, value_text, source_label')
    .eq('plan_id', planId)
  if (readErr) return { ok: false, kind: 'error', message: readErr.message }

  const conflicts = detectConflicts((allInputs ?? []) as InputLike[])
  // Refresh unresolved conflict exceptions for this plan.
  await db.from('fna_data_quality_exceptions').delete().eq('plan_id', planId).eq('kind', 'conflicting').eq('resolved', false)
  if (conflicts.length > 0) {
    await db.from('fna_data_quality_exceptions').insert(
      conflicts.map((c) => ({ plan_id: planId, kind: c.kind, severity: c.severity, section: c.section, key: c.key, detail: c.detail })),
    )
  }
  return { ok: true, data: { written: rows.length, conflicts: conflicts.length } }
}

/** All input rows for a plan (for calculation + conflict/quality views). */
export async function getPlanInputs(
  planId: string,
): Promise<StoreResult<Array<{ key: string; section: string; value_numeric: number | null; source_label: string }>>> {
  const { data, error } = await getDb()
    .from('fna_inputs')
    .select('key, section, value_numeric, source_label')
    .eq('plan_id', planId)
  if (error) return { ok: false, kind: 'error', message: error.message }
  return { ok: true, data: (data ?? []) as Array<{ key: string; section: string; value_numeric: number | null; source_label: string }> }
}

// ── Assumption sets ──────────────────────────────────────────────────────────
/**
 * The active assumption-set for a household: a household-scoped active set if one
 * exists, else the global default-v1, else the engine's DEFAULT_ASSUMPTIONS (so
 * the engine always has a labeled set even before the seed row is queried).
 */
export async function getActiveAssumptionSet(householdId?: string): Promise<AssumptionSet> {
  const db = getDb()
  if (householdId) {
    const { data } = await db
      .from('fna_assumption_sets')
      .select('version, label, assumptions')
      .eq('scope', 'household')
      .eq('household_id', householdId)
      .eq('is_active', true)
      .order('updated_at', { ascending: false })
      .maybeSingle()
    if (data) return { version: data.version, label: data.label, assumptions: data.assumptions } as AssumptionSet
  }
  const { data: global } = await db
    .from('fna_assumption_sets')
    .select('version, label, assumptions')
    .eq('version', 'default-v1')
    .maybeSingle()
  if (global) return { version: global.version, label: global.label, assumptions: global.assumptions } as AssumptionSet
  return DEFAULT_ASSUMPTIONS
}

// ── Versions (immutable snapshots) ───────────────────────────────────────────
export interface VersionResultInput {
  formula_id: string
  formula_version: string
  goal_id?: string | null
  envelope: unknown
  confidence?: 'high' | 'medium' | 'low' | null
}

export interface CreateVersionArgs {
  assumptionSet: AssumptionSet
  inputsSnapshot: Record<string, unknown>
  results?: VersionResultInput[]
  narrative?: Record<string, unknown> | null
  status?: FnaStatus
  actor: string
}

export interface FnaVersionRow {
  id: string
  plan_id: string
  version_no: number
  status: FnaStatus
  assumption_set_version: string
  engine_version: string
  created_at: string
}

/**
 * Freeze a new immutable version for a plan: allocate the next version_no, snapshot
 * the assumption-set + inputs + rolled-up results, persist per-formula result rows,
 * and point the plan at the new version. Nothing overwrites prior versions.
 */
export async function createVersion(planId: string, args: CreateVersionArgs): Promise<StoreResult<FnaVersionRow>> {
  const db = getDb()
  const plan = await getPlan(planId)
  if (!plan.ok) return plan

  const { data: existing, error: exErr } = await db.from('fna_versions').select('version_no').eq('plan_id', planId)
  if (exErr) return { ok: false, kind: 'error', message: exErr.message }
  const versionNo = nextVersionNo((existing ?? []).map((r) => r.version_no as number))

  const rollup: Record<string, unknown> = {}
  for (const r of args.results ?? []) rollup[r.formula_id] = r.envelope

  const { data: version, error: vErr } = await db
    .from('fna_versions')
    .insert({
      plan_id: planId,
      version_no: versionNo,
      status: args.status ?? 'CALCULATED',
      assumption_set: args.assumptionSet,
      assumption_set_version: args.assumptionSet.version,
      engine_version: ENGINE_VERSION,
      inputs_snapshot: args.inputsSnapshot,
      results: rollup,
      narrative: args.narrative ?? null,
      created_by: args.actor,
    })
    .select('id, plan_id, version_no, status, assumption_set_version, engine_version, created_at')
    .single()
  if (vErr) return { ok: false, kind: 'error', message: vErr.message }

  if ((args.results ?? []).length > 0) {
    const { error: rErr } = await db.from('fna_results').insert(
      (args.results ?? []).map((r) => ({
        version_id: version.id,
        plan_id: planId,
        goal_id: r.goal_id ?? null,
        formula_id: r.formula_id,
        formula_version: r.formula_version,
        envelope: r.envelope,
        confidence: r.confidence ?? null,
      })),
    )
    if (rErr) return { ok: false, kind: 'error', message: rErr.message }
  }

  // Point the plan at the new version and advance status to CALCULATED if it was
  // earlier in the flow (never downgrade an APPROVED/UNDER_REVIEW plan here).
  const advance = plan.data.status === 'DRAFT' || plan.data.status === 'IN_PROGRESS'
  await db
    .from('fna_plans')
    .update({ current_version_id: version.id, updated_by: args.actor, ...(advance ? { status: 'CALCULATED' } : {}) })
    .eq('id', planId)

  return { ok: true, data: version as FnaVersionRow }
}

/**
 * Persist the existing narrative save (ADR-016 §"save path preserved & extended"):
 * find-or-create a live plan for the household and freeze a version snapshotting the
 * narrative + the active assumption-set. Reuses the most recent non-terminal plan so
 * repeated saves don't proliferate plans. Called best-effort from /api/fna/save —
 * the document+activities write must never depend on this succeeding.
 */
export async function persistNarrativeSnapshot(
  householdId: string,
  narrative: Record<string, unknown>,
  actor: string,
  opts: { planType?: string; title?: string } = {},
): Promise<StoreResult<{ plan_id: string; version_id: string }>> {
  const db = getDb()
  const { data: existing } = await db
    .from('fna_plans')
    .select('id, status')
    .eq('household_id', householdId)
    .is('deleted_at', null)
    .in('status', ['DRAFT', 'IN_PROGRESS', 'CALCULATED', 'UNDER_REVIEW'])
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  let planId = existing?.id as string | undefined
  if (!planId) {
    const created = await createPlan(householdId, opts.planType ?? 'comprehensive', { title: opts.title, actor })
    if (!created.ok) return created
    planId = created.data.id
  }

  const assumptionSet = await getActiveAssumptionSet(householdId)
  const version = await createVersion(planId, {
    assumptionSet,
    inputsSnapshot: {},
    narrative,
    status: 'CALCULATED',
    actor,
  })
  if (!version.ok) return version
  return { ok: true, data: { plan_id: planId, version_id: version.data.id } }
}

/** Mark a version APPROVED and stamp the approver (only from UNDER_REVIEW). */
export async function approveVersion(versionId: string, actor: string): Promise<StoreResult<FnaVersionRow>> {
  const db = getDb()
  const { data: v, error } = await db.from('fna_versions').select('id, plan_id, status').eq('id', versionId).maybeSingle()
  if (error) return { ok: false, kind: 'error', message: error.message }
  if (!v) return { ok: false, kind: 'not_found', message: 'Version not found' }
  if (!canTransition(v.status as FnaStatus, 'APPROVED')) {
    return { ok: false, kind: 'invalid_transition', message: `cannot approve from ${v.status}` }
  }
  const { data: updated, error: uErr } = await db
    .from('fna_versions')
    .update({ status: 'APPROVED', approved_by: actor, approved_at: new Date().toISOString() })
    .eq('id', versionId)
    .select('id, plan_id, version_no, status, assumption_set_version, engine_version, created_at')
    .single()
  if (uErr) return { ok: false, kind: 'error', message: uErr.message }
  await db.from('fna_plans').update({ status: 'APPROVED', updated_by: actor }).eq('id', v.plan_id)
  return { ok: true, data: updated as FnaVersionRow }
}
