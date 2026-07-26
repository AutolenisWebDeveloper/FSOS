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
): Promise<ConfigResult<{ id: string }>> {
  if (Object.keys(patch).length === 0) return { ok: false, kind: 'error', message: 'No fields to update.' }
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

export async function deleteAvailabilityRule(actor: string, id: string): Promise<ConfigResult<{ id: string }>> {
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
