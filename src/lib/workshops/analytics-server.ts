// src/lib/workshops/analytics-server.ts
// Server-only aggregation loader for the P1 workshop dashboard + per-workshop report.
// Runs with the service-role db client (getDb) passed in by the caller; never instantiates
// a client (CLAUDE.md §1 convention 1). Pure math lives in ./attendance.ts — this file only
// fetches rows and shapes them for those pure functions, so the same numbers back both the
// dashboard and the report.

import {
  computeAttendanceStats,
  computeConsultConversion,
  attributeLeadSource,
  type RegLite,
  type AttLite,
  type AttendanceStats,
  type ConsultConversion,
  type LeadSourceRow,
} from './attendance'

type Db = ReturnType<typeof import('@/lib/supabase/client')['getDb']>

export interface WorkshopRecord {
  workshop_id: string
  title: string
  topic: string | null
  status: string | null
  delivery_mode: string | null
  scheduled_at: string | null
  max_attendees: number | null
  is_security: boolean | null
  budget_spend: number | null
  budget_spend_note: string | null
}

export interface WorkshopGroup {
  key: string
  label: string
  kind: 'presenter' | 'fund_family'
}

export interface WorkshopAnalytics {
  workshop: WorkshopRecord
  regs: RegLite[]
  attendance: AttLite[]
  groups: WorkshopGroup[]
  stats: AttendanceStats
  consults: ConsultConversion
  leadSources: LeadSourceRow[]
}

/** Load all non-deleted workshops scheduled within [yearStartIso, yearEndIso). */
export async function loadWorkshopsForYear(db: Db, yearStartIso: string, yearEndIso: string): Promise<WorkshopRecord[]> {
  const { data } = await db
    .from('workshops')
    .select('workshop_id, title, topic, status, delivery_mode, scheduled_at, max_attendees, is_security, budget_spend, budget_spend_note')
    .gte('scheduled_at', yearStartIso)
    .lt('scheduled_at', yearEndIso)
    .order('scheduled_at', { ascending: false, nullsFirst: false })
  return (data as WorkshopRecord[]) ?? []
}

/** Load one workshop by id (any date). */
export async function loadWorkshop(db: Db, workshopId: string): Promise<WorkshopRecord | null> {
  const { data } = await db
    .from('workshops')
    .select('workshop_id, title, topic, status, delivery_mode, scheduled_at, max_attendees, is_security, budget_spend, budget_spend_note')
    .eq('workshop_id', workshopId)
    .maybeSingle()
  return (data as WorkshopRecord) ?? null
}

interface RegRow {
  reg_id: string
  workshop_id: string
  chosen_delivery: string | null
  is_walk_in: boolean | null
  lead_source: string | null
  referral_id: string | null
  ghl_opportunity_id: string | null
  appointment_booked: boolean | null
}

/**
 * Build per-workshop analytics for a set of workshops in a bounded number of queries
 * (registrations, attendance, presenters) — not one query per workshop. Returns a map
 * keyed by workshop_id. Each entry's stats/consults/leadSources come from the pure lib.
 */
export async function buildWorkshopAnalytics(db: Db, workshops: WorkshopRecord[]): Promise<Map<string, WorkshopAnalytics>> {
  const ids = workshops.map((w) => w.workshop_id)
  const out = new Map<string, WorkshopAnalytics>()
  if (ids.length === 0) return out

  // Registrations for all workshops.
  const { data: regData } = await db
    .from('workshop_registrations')
    .select('reg_id, workshop_id, chosen_delivery, is_walk_in, lead_source, referral_id, ghl_opportunity_id, appointment_booked')
    .in('workshop_id', ids)
  const regs = (regData as RegRow[]) ?? []

  // Attendance for those registrations (keyed by registration_id → workshop via regs).
  const regIds = regs.map((r) => r.reg_id)
  const attByReg = new Map<string, AttLite>()
  if (regIds.length > 0) {
    // Supabase caps .in() lists; chunk to stay well under the limit.
    for (const chunk of chunkArray(regIds, 300)) {
      const { data: att } = await db
        .from('workshop_attendance')
        .select('registration_id, status, capture_method')
        .in('registration_id', chunk)
      for (const a of (att as AttLite[]) ?? []) attByReg.set(a.registration_id, a)
    }
  }

  // Presenters (name + fund_family) per workshop → grouping keys.
  const groupsByWorkshop = new Map<string, WorkshopGroup[]>()
  const { data: wp } = await db.from('workshop_presenters').select('workshop_id, presenter_id').in('workshop_id', ids)
  const presenterIds = [...new Set(((wp as { workshop_id: string; presenter_id: string }[]) ?? []).map((r) => r.presenter_id))]
  const presenterById = new Map<string, { name: string; fund_family: string | null }>()
  if (presenterIds.length > 0) {
    const { data: pres } = await db.from('presenters').select('id, name, fund_family').in('id', presenterIds)
    for (const p of (pres as { id: string; name: string; fund_family: string | null }[]) ?? []) {
      presenterById.set(p.id, { name: p.name, fund_family: p.fund_family })
    }
  }
  for (const link of ((wp as { workshop_id: string; presenter_id: string }[]) ?? [])) {
    const p = presenterById.get(link.presenter_id)
    if (!p) continue
    const list = groupsByWorkshop.get(link.workshop_id) ?? []
    list.push({ key: `presenter:${link.presenter_id}`, label: p.name, kind: 'presenter' })
    if (p.fund_family && p.fund_family.trim()) {
      list.push({ key: `fund:${p.fund_family.trim().toLowerCase()}`, label: p.fund_family.trim(), kind: 'fund_family' })
    }
    groupsByWorkshop.set(link.workshop_id, list)
  }

  // Group registrations by workshop.
  const regsByWorkshop = new Map<string, RegLite[]>()
  const attByWorkshop = new Map<string, AttLite[]>()
  for (const r of regs) {
    const rl: RegLite = {
      reg_id: r.reg_id,
      chosen_delivery: r.chosen_delivery,
      is_walk_in: r.is_walk_in,
      lead_source: r.lead_source,
      referral_id: r.referral_id,
      ghl_opportunity_id: r.ghl_opportunity_id,
      appointment_booked: r.appointment_booked,
    }
    const list = regsByWorkshop.get(r.workshop_id) ?? []
    list.push(rl)
    regsByWorkshop.set(r.workshop_id, list)
    const a = attByReg.get(r.reg_id)
    if (a) {
      const alist = attByWorkshop.get(r.workshop_id) ?? []
      alist.push(a)
      attByWorkshop.set(r.workshop_id, alist)
    }
  }

  for (const w of workshops) {
    const wregs = regsByWorkshop.get(w.workshop_id) ?? []
    const watt = attByWorkshop.get(w.workshop_id) ?? []
    out.set(w.workshop_id, {
      workshop: w,
      regs: wregs,
      attendance: watt,
      groups: groupsByWorkshop.get(w.workshop_id) ?? [],
      stats: computeAttendanceStats(wregs, watt),
      consults: computeConsultConversion(wregs),
      leadSources: attributeLeadSource(wregs, watt),
    })
  }
  return out
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size))
  return chunks
}
