// src/lib/import/mapping/store.ts
// ─────────────────────────────────────────────────────────────────────────
// Persistence for the mapping model's memory (spec §5): saved templates keyed by
// header signature, global per-header memory, and the operator custom-field
// registry. All access is through getDb() (service role, after an RBAC assertion
// in the route). RLS on these tables is deny-by-default for JWT callers; the
// service client is the only writer — matching every other importer in FSOS.
//
// This module is the ONLY place that reads/writes import_templates,
// import_header_memory, and custom_fields, so the memory model stays consistent.
// ─────────────────────────────────────────────────────────────────────────

import type { SupabaseClient } from '@supabase/supabase-js'
import type { HeaderDecision } from './plan'
import type { FieldEntity, FieldType } from './fields'

type Db = SupabaseClient

export interface CustomFieldDef {
  entity: FieldEntity
  key: string
  label: string
  fieldType: FieldType
}

export interface SavedTemplate {
  id: string
  name: string
  templateKey: string | null
  headerMap: Record<string, HeaderDecision>
}

/** Load the saved template whose header signature matches this file, or null. */
export async function loadTemplateBySignature(db: Db, signature: string): Promise<SavedTemplate | null> {
  const { data, error } = await db
    .from('import_templates')
    .select('id, name, template_key, header_map')
    .eq('source_signature', signature)
    .maybeSingle()
  if (error || !data) return null
  return {
    id: data.id as string,
    name: (data.name as string) ?? '',
    templateKey: (data.template_key as string) ?? null,
    headerMap: (data.header_map as Record<string, HeaderDecision>) ?? {},
  }
}

/**
 * Upsert a template for a signature: refresh its header_map/name/template_key and
 * bump usage_count + last_used_at. Best-effort — a memory-write failure never
 * fails an import (the contacts are already durably stored).
 */
export async function saveTemplate(
  db: Db,
  input: { signature: string; name: string; templateKey?: string | null; headerMap: Record<string, HeaderDecision>; actor?: string | null },
): Promise<void> {
  try {
    const existing = await db.from('import_templates').select('id, usage_count').eq('source_signature', input.signature).maybeSingle()
    const nowIso = new Date().toISOString()
    if (existing.data?.id) {
      await db.from('import_templates').update({
        name: input.name,
        template_key: input.templateKey ?? null,
        header_map: input.headerMap,
        usage_count: ((existing.data.usage_count as number) ?? 0) + 1,
        last_used_at: nowIso,
      }).eq('id', existing.data.id as string)
    } else {
      await db.from('import_templates').insert({
        name: input.name,
        source_signature: input.signature,
        template_key: input.templateKey ?? null,
        header_map: input.headerMap,
        usage_count: 1,
        last_used_at: nowIso,
        created_by: input.actor ?? null,
      })
    }
  } catch {
    /* best-effort memory write */
  }
}

/** Load global per-header memory for the given squashed headers → decision map. */
export async function loadHeaderMemory(db: Db, squashedHeaders: string[]): Promise<Record<string, HeaderDecision>> {
  const keys = Array.from(new Set(squashedHeaders.filter(Boolean)))
  if (keys.length === 0) return {}
  const { data, error } = await db
    .from('import_header_memory')
    .select('squashed_header, decision')
    .in('squashed_header', keys)
  if (error || !data) return {}
  const out: Record<string, HeaderDecision> = {}
  for (const r of data as Array<{ squashed_header: string; decision: HeaderDecision }>) {
    out[r.squashed_header] = r.decision
  }
  return out
}

/**
 * Remember each manual/confirmed header decision globally (upsert by squashed
 * header, bump usage_count). Skips `unrecognized` decisions (nothing to learn).
 */
export async function rememberHeaderDecisions(
  db: Db,
  entries: Array<{ squashed: string; sampleHeader: string; decision: HeaderDecision }>,
): Promise<void> {
  const rows = entries.filter((e) => e.squashed && e.decision.kind !== 'unrecognized')
  if (rows.length === 0) return
  const nowIso = new Date().toISOString()
  for (const e of rows) {
    try {
      const existing = await db.from('import_header_memory').select('usage_count').eq('squashed_header', e.squashed).maybeSingle()
      if (existing.data) {
        await db.from('import_header_memory').update({
          decision: e.decision,
          sample_header: e.sampleHeader,
          usage_count: ((existing.data.usage_count as number) ?? 1) + 1,
          last_used_at: nowIso,
        }).eq('squashed_header', e.squashed)
      } else {
        await db.from('import_header_memory').insert({
          squashed_header: e.squashed,
          sample_header: e.sampleHeader,
          decision: e.decision,
          usage_count: 1,
          last_used_at: nowIso,
        })
      }
    } catch {
      /* best-effort */
    }
  }
}

/** List every operator-defined custom field (for the mapping dropdown). */
export async function listCustomFields(db: Db): Promise<CustomFieldDef[]> {
  const { data, error } = await db.from('custom_fields').select('entity, key, label, field_type').order('entity').order('key')
  if (error || !data) return []
  return (data as Array<{ entity: FieldEntity; key: string; label: string; field_type: FieldType }>).map((r) => ({
    entity: r.entity,
    key: r.key,
    label: r.label,
    fieldType: r.field_type,
  }))
}

/**
 * Create any custom fields referenced by the confirmed mapping that don't yet
 * exist. Upsert-by-(entity,key); idempotent. Returns the count created.
 */
export async function ensureCustomFields(db: Db, defs: CustomFieldDef[], actor?: string | null): Promise<number> {
  if (defs.length === 0) return 0
  // De-dupe by (entity,key).
  const byKey = new Map<string, CustomFieldDef>()
  for (const d of defs) byKey.set(`${d.entity}.${d.key}`, d)
  let created = 0
  for (const d of byKey.values()) {
    try {
      const existing = await db.from('custom_fields').select('id').eq('entity', d.entity).eq('key', d.key).maybeSingle()
      if (existing.data) continue
      const { error } = await db.from('custom_fields').insert({
        entity: d.entity,
        key: d.key,
        label: d.label,
        field_type: d.fieldType,
        created_by: actor ?? null,
      })
      if (!error) created++
    } catch {
      /* best-effort */
    }
  }
  return created
}
