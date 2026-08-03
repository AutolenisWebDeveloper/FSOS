// src/lib/booking/config.ts
// Impure service layer for the FSA booking-configuration surface (Slice 2): CRUD on the
// three config tables added in mig 069 (appointment_types, availability_rules,
// availability_blackouts). Thin route handlers parse with config-schemas.ts, then call
// these; business logic + persistence + audit live here, never in the route (§3.1.8).
//
// Scoping: single-practice FSOS. New rows are stamped with host_user_id = the acting FSA
// user so a future multi-host deployment already carries ownership; reads return the
// configured set (RLS is default-deny — these run service-role AFTER an rbac assertion).

import { getDb } from '@/lib/supabase/client'
import { writeAudit } from '@/lib/audit/log'
import { ruleFromRow, type AvailabilityRule, type AvailabilityRuleRow } from './availability'
import { appointmentsOutsideTemplate } from './availability-rules-validate'
import type {
  AppointmentTypeCreateInput,
  AppointmentTypeUpdateInput,
  AvailabilityRuleCreateInput,
  AvailabilityRuleUpdateInput,
  BlackoutCreateInput,
} from './config-schemas'

export type ConfigResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: 'not_found' | 'conflict' | 'error'; message: string }

// ── Availability-change conflict detection (narrowing hours vs already-booked appointments) ──────
// A template change governs FUTURE slots, not commitments already made. So we NEVER auto-cancel or
// move an existing appointment. Instead, before a NARROWING change (update / delete) commits, we
// count future scheduled appointments that would fall outside the new template and, unless the
// caller explicitly acknowledges, refuse with `availability_conflict` so the FSA sees them first.
//
// Concurrency: this is a point-in-time read (candidate rules + future appointments) followed by a
// single atomic rule write — NOT one serialized transaction. A booking or rule edit landing between
// the check and the write is not folded in. This is an accepted risk for the single-FSA deployment
// (one actor); the appointments are never destroyed regardless, only surfaced, so the worst case is
// a stale count, never data loss. A serializable txn / advisory lock is the hardening path if FSOS
// ever runs concurrent editors.
export interface OutsideAppointment {
  id: string
  starts_at: string
}
export interface AvailabilityConflict {
  ok: false
  kind: 'availability_conflict'
  message: string
  outside: OutsideAppointment[]
}

interface RawRuleRow {
  id: string
  weekday: number
  start_time: string
  end_time: string
  timezone: string
  effective_start: string | null
  effective_end: string | null
  active: boolean
}
const RULE_COLS = 'id, weekday, start_time, end_time, timezone, effective_start, effective_end, active'

/** All availability rules applying to this host (own + practice-wide), for conflict evaluation. */
async function ruleRowsForHost(actor: string): Promise<RawRuleRow[]> {
  const { data } = await getDb()
    .from('availability_rules')
    .select(RULE_COLS)
    .or(`host_user_id.eq.${actor},host_user_id.is.null`)
  return (data ?? []) as RawRuleRow[]
}

/** The active candidate rules (post-change), mapped through the SAME engine mapper the slot
 *  calculator uses — so "outside" is judged exactly as the engine reads rules. */
function candidateActive(rows: RawRuleRow[]): AvailabilityRule[] {
  return rows.filter((r) => r.active !== false).map((r) => ruleFromRow(r as unknown as AvailabilityRuleRow))
}

/** Future scheduled appointments whose start falls outside the candidate active template. */
async function futureAppointmentsOutside(candidate: AvailabilityRule[]): Promise<OutsideAppointment[]> {
  const nowIso = new Date().toISOString()
  const { data } = await getDb()
    .from('appointments')
    .select('id, starts_at')
    .eq('status', 'scheduled')
    .gt('starts_at', nowIso)
    .limit(2000)
  return appointmentsOutsideTemplate((data ?? []) as { id: string; starts_at: string | null }[], candidate).map((a) => ({
    id: a.id,
    starts_at: a.starts_at as string,
  }))
}

function availabilityConflict(outside: OutsideAppointment[]): AvailabilityConflict {
  const n = outside.length
  return {
    ok: false,
    kind: 'availability_conflict',
    message: `${n} upcoming appointment${n === 1 ? '' : 's'} would fall outside the new availability. They are kept unchanged — acknowledge to save this change.`,
    outside,
  }
}

// PostgREST/Postgres unique-violation code.
const UNIQUE_VIOLATION = '23505'

function fail(error: { code?: string; message: string } | null, conflictMsg: string): { ok: false; kind: 'conflict' | 'error'; message: string } {
  if (error?.code === UNIQUE_VIOLATION) return { ok: false, kind: 'conflict', message: conflictMsg }
  return { ok: false, kind: 'error', message: error?.message ?? 'Unknown error' }
}

// ── Appointment types ────────────────────────────────────────────────────────────
export async function listAppointmentTypes(): Promise<ConfigResult<Record<string, unknown>[]>> {
  const { data, error } = await getDb()
    .from('appointment_types')
    .select('*')
    .order('active', { ascending: false })
    .order('name', { ascending: true })
  if (error) return { ok: false, kind: 'error', message: error.message }
  return { ok: true, data: data ?? [] }
}

export async function createAppointmentType(
  actor: string,
  input: AppointmentTypeCreateInput,
): Promise<ConfigResult<{ id: string }>> {
  const { data, error } = await getDb()
    .from('appointment_types')
    .insert({ ...input, host_user_id: actor })
    .select('id')
    .maybeSingle()
  if (error || !data) return fail(error, 'An appointment type with that slug already exists.')
  await writeAudit({ actor, action: 'config.changed', entity: 'appointment_type', entityId: data.id, diff: { created: input.name } })
  return { ok: true, data: { id: data.id } }
}

export async function updateAppointmentType(
  actor: string,
  id: string,
  patch: AppointmentTypeUpdateInput,
): Promise<ConfigResult<{ id: string }>> {
  if (Object.keys(patch).length === 0) return { ok: false, kind: 'error', message: 'No fields to update.' }
  const { data, error } = await getDb()
    .from('appointment_types')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id')
    .maybeSingle()
  if (error) return fail(error, 'An appointment type with that slug already exists.')
  if (!data) return { ok: false, kind: 'not_found', message: 'Appointment type not found.' }
  await writeAudit({ actor, action: 'config.changed', entity: 'appointment_type', entityId: id, diff: { updated: Object.keys(patch) } })
  return { ok: true, data: { id } }
}

export async function deleteAppointmentType(actor: string, id: string): Promise<ConfigResult<{ id: string }>> {
  // Existing appointments keep their history (FK is ON DELETE SET NULL, mig 069).
  const { data, error } = await getDb().from('appointment_types').delete().eq('id', id).select('id').maybeSingle()
  if (error) return { ok: false, kind: 'error', message: error.message }
  if (!data) return { ok: false, kind: 'not_found', message: 'Appointment type not found.' }
  await writeAudit({ actor, action: 'config.changed', entity: 'appointment_type', entityId: id, diff: { deleted: true } })
  return { ok: true, data: { id } }
}

// ── Availability rules ───────────────────────────────────────────────────────────
export async function listAvailabilityRules(): Promise<ConfigResult<Record<string, unknown>[]>> {
  const { data, error } = await getDb()
    .from('availability_rules')
    .select('*')
    .order('weekday', { ascending: true })
    .order('start_time', { ascending: true })
  if (error) return { ok: false, kind: 'error', message: error.message }
  return { ok: true, data: data ?? [] }
}

export async function createAvailabilityRule(
  actor: string,
  input: AvailabilityRuleCreateInput,
): Promise<ConfigResult<{ id: string }>> {
  const { data, error } = await getDb()
    .from('availability_rules')
    .insert({ ...input, host_user_id: actor })
    .select('id')
    .maybeSingle()
  if (error || !data) return { ok: false, kind: 'error', message: error?.message ?? 'Insert failed.' }
  await writeAudit({ actor, action: 'config.changed', entity: 'availability_rule', entityId: data.id, diff: { weekday: input.weekday } })
  return { ok: true, data: { id: data.id } }
}

export async function updateAvailabilityRule(
  actor: string,
  id: string,
  patch: AvailabilityRuleUpdateInput,
  opts: { acknowledge?: boolean } = {},
): Promise<ConfigResult<{ id: string }> | AvailabilityConflict> {
  if (Object.keys(patch).length === 0) return { ok: false, kind: 'error', message: 'No fields to update.' }
  // A narrowing edit is checked against future appointments unless explicitly acknowledged.
  if (!opts.acknowledge) {
    const rows = await ruleRowsForHost(actor)
    if (!rows.some((r) => r.id === id)) return { ok: false, kind: 'not_found', message: 'Availability rule not found.' }
    const candidate = candidateActive(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)))
    const outside = await futureAppointmentsOutside(candidate)
    if (outside.length > 0) return availabilityConflict(outside)
  }
  const { data, error } = await getDb()
    .from('availability_rules')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id')
    .maybeSingle()
  if (error) return { ok: false, kind: 'error', message: error.message }
  if (!data) return { ok: false, kind: 'not_found', message: 'Availability rule not found.' }
  await writeAudit({ actor, action: 'config.changed', entity: 'availability_rule', entityId: id, diff: { updated: Object.keys(patch) } })
  return { ok: true, data: { id } }
}

export async function deleteAvailabilityRule(
  actor: string,
  id: string,
  opts: { acknowledge?: boolean } = {},
): Promise<ConfigResult<{ id: string }> | AvailabilityConflict> {
  // Removing a window narrows availability — check future appointments unless acknowledged.
  if (!opts.acknowledge) {
    const rows = await ruleRowsForHost(actor)
    if (!rows.some((r) => r.id === id)) return { ok: false, kind: 'not_found', message: 'Availability rule not found.' }
    const candidate = candidateActive(rows.filter((r) => r.id !== id))
    const outside = await futureAppointmentsOutside(candidate)
    if (outside.length > 0) return availabilityConflict(outside)
  }
  const { data, error } = await getDb().from('availability_rules').delete().eq('id', id).select('id').maybeSingle()
  if (error) return { ok: false, kind: 'error', message: error.message }
  if (!data) return { ok: false, kind: 'not_found', message: 'Availability rule not found.' }
  await writeAudit({ actor, action: 'config.changed', entity: 'availability_rule', entityId: id, diff: { deleted: true } })
  return { ok: true, data: { id } }
}

// ── Blackouts ────────────────────────────────────────────────────────────────────
export async function listBlackouts(): Promise<ConfigResult<Record<string, unknown>[]>> {
  const { data, error } = await getDb()
    .from('availability_blackouts')
    .select('*')
    .order('starts_at', { ascending: true })
  if (error) return { ok: false, kind: 'error', message: error.message }
  return { ok: true, data: data ?? [] }
}

export async function createBlackout(actor: string, input: BlackoutCreateInput): Promise<ConfigResult<{ id: string }>> {
  const { data, error } = await getDb()
    .from('availability_blackouts')
    .insert({ ...input, host_user_id: actor })
    .select('id')
    .maybeSingle()
  if (error || !data) return { ok: false, kind: 'error', message: error?.message ?? 'Insert failed.' }
  await writeAudit({ actor, action: 'config.changed', entity: 'availability_blackout', entityId: data.id, diff: { starts_at: input.starts_at } })
  return { ok: true, data: { id: data.id } }
}

export async function deleteBlackout(actor: string, id: string): Promise<ConfigResult<{ id: string }>> {
  const { data, error } = await getDb().from('availability_blackouts').delete().eq('id', id).select('id').maybeSingle()
  if (error) return { ok: false, kind: 'error', message: error.message }
  if (!data) return { ok: false, kind: 'not_found', message: 'Blackout not found.' }
  await writeAudit({ actor, action: 'config.changed', entity: 'availability_blackout', entityId: id, diff: { deleted: true } })
  return { ok: true, data: { id } }
}
