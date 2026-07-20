// src/lib/workshops/attendance.ts
// Pure, dependency-free decision + aggregation logic for the Workshop/Seminar lead
// engine P1 (attendance capture, roster, dashboard, reporting). Kept side-effect-free
// so it can be unit-tested standalone (compiled by tsc in the test harness) AND reused
// by the API routes + server components. The routes/pages gather the DB rows; these
// functions decide + aggregate. Mirrors the pattern in src/lib/workshops/logic.ts.

export type AttendanceStatus = 'registered' | 'attended' | 'no_show' | 'left_early'
export type CaptureMethod = 'checkin' | 'webhook' | 'manual'
export type Delivery = 'in_person' | 'virtual'

// ── Attendance-status transition (idempotency for check-in) ─────────────────────
// A double-scan of the same token is a NO-OP: an already-'attended' registrant that is
// checked in again should not flip or duplicate anything. Manual reconcile MAY overwrite
// with a chosen status (attended/no_show/left_early). This helper centralizes the rule.

export interface AttendanceRow {
  status: AttendanceStatus
  capture_method?: CaptureMethod | null
}

/**
 * Decide the effective attendance write for a check-in scan.
 * Returns `null` when the scan is a no-op (already attended via check-in) — the route
 * then skips the write entirely (idempotent, no audit noise, no data churn).
 */
export function resolveCheckIn(existing: AttendanceRow | null): {
  status: AttendanceStatus
  capture_method: CaptureMethod
} | null {
  if (existing && existing.status === 'attended') return null
  return { status: 'attended', capture_method: 'checkin' }
}

// ── Attendance aggregation (dashboard + per-workshop report) ────────────────────

export interface RegLite {
  reg_id: string
  chosen_delivery?: Delivery | string | null
  is_walk_in?: boolean | null
  lead_source?: string | null
  referral_id?: string | null
  ghl_opportunity_id?: string | null
  appointment_booked?: boolean | null
}

export interface AttLite {
  registration_id: string
  status: AttendanceStatus | string
  capture_method?: CaptureMethod | string | null
}

export interface AttendanceStats {
  registrations: number
  attended: number
  noShow: number
  leftEarly: number
  /** attended / registrations, 0..1 (0 when no registrations). */
  attendanceRate: number
  /** no_show / registrations, 0..1. */
  noShowRate: number
  /** attendance split by chosen delivery. */
  inPerson: { registrations: number; attended: number; attendanceRate: number }
  virtual: { registrations: number; attended: number; attendanceRate: number }
}

/** Safe ratio helper — 0 when the denominator is 0 (never NaN/Infinity in the UI). */
export function ratio(numerator: number, denominator: number): number {
  if (!denominator || denominator <= 0) return 0
  return numerator / denominator
}

/** Build the attendance-status map keyed by registration id (latest row wins). */
export function attendanceByReg(attendance: AttLite[]): Map<string, AttendanceStatus> {
  const m = new Map<string, AttendanceStatus>()
  for (const a of attendance) {
    const s = a.status as AttendanceStatus
    m.set(a.registration_id, s)
  }
  return m
}

/**
 * Compute attendance stats for one workshop/session from its registrations + attendance
 * rows. A registration with no attendance row counts as not-attended (registered). The
 * in-person/virtual split keys off the registration's chosen_delivery (falls back to
 * counting under in_person when unspecified, since that is the default delivery).
 */
export function computeAttendanceStats(regs: RegLite[], attendance: AttLite[]): AttendanceStats {
  const byReg = attendanceByReg(attendance)
  let attended = 0
  let noShow = 0
  let leftEarly = 0
  const ip = { registrations: 0, attended: 0, attendanceRate: 0 }
  const vr = { registrations: 0, attended: 0, attendanceRate: 0 }

  for (const r of regs) {
    const status = byReg.get(r.reg_id) ?? 'registered'
    const isVirtual = r.chosen_delivery === 'virtual'
    const bucket = isVirtual ? vr : ip
    bucket.registrations++
    const didAttend = status === 'attended' || status === 'left_early'
    if (status === 'attended') attended++
    if (status === 'no_show') noShow++
    if (status === 'left_early') leftEarly++
    if (didAttend) bucket.attended++
  }

  const registrations = regs.length
  // "attended" for the headline rate includes left_early (they showed up).
  const showed = attended + leftEarly
  ip.attendanceRate = ratio(ip.attended, ip.registrations)
  vr.attendanceRate = ratio(vr.attended, vr.registrations)

  return {
    registrations,
    attended,
    noShow,
    leftEarly,
    attendanceRate: ratio(showed, registrations),
    noShowRate: ratio(noShow, registrations),
    inPerson: ip,
    virtual: vr,
  }
}

// ── Consult-conversion funnel (registration → consult booked → showed) ──────────

export interface ConsultConversion {
  registrations: number
  /** attendees converted to a lead/consult (referral or GHL opportunity created). */
  consultsBooked: number
  /** of those, how many showed (appointment_booked === true). */
  consultsShowed: number
  /** consultsBooked / registrations, 0..1. */
  bookedRate: number
  /** consultsShowed / consultsBooked, 0..1. */
  showRate: number
}

/**
 * A registration is "converted to a consult/lead" when the manual convert produced a
 * referral or a GHL opportunity. "Showed" reuses the existing appointment_booked flag on
 * the registration (the consult was actually booked/kept). Both are conservative counts.
 */
export function computeConsultConversion(regs: RegLite[]): ConsultConversion {
  let booked = 0
  let showed = 0
  for (const r of regs) {
    const converted = !!r.referral_id || !!r.ghl_opportunity_id
    if (converted) booked++
    if (converted && r.appointment_booked) showed++
  }
  return {
    registrations: regs.length,
    consultsBooked: booked,
    consultsShowed: showed,
    bookedRate: ratio(booked, regs.length),
    showRate: ratio(showed, booked),
  }
}

// ── Lead-source attribution (referring agency slug / campaign / UTM) ────────────

export interface LeadSourceRow {
  source: string
  registrations: number
  attended: number
  converted: number
}

/** Group registrations by their immutable lead_source, with attendance + convert counts. */
export function attributeLeadSource(regs: RegLite[], attendance: AttLite[]): LeadSourceRow[] {
  const byReg = attendanceByReg(attendance)
  const map = new Map<string, LeadSourceRow>()
  for (const r of regs) {
    const source = (r.lead_source && r.lead_source.trim()) || 'workshop'
    const row = map.get(source) ?? { source, registrations: 0, attended: 0, converted: 0 }
    row.registrations++
    const status = byReg.get(r.reg_id)
    if (status === 'attended' || status === 'left_early') row.attended++
    if (r.referral_id || r.ghl_opportunity_id) row.converted++
    map.set(source, row)
  }
  return [...map.values()].sort((a, b) => b.registrations - a.registrations)
}

// ── Cost-per-lead (only when spend is entered) ──────────────────────────────────

/**
 * Cost per lead = spend / leads. Returns null when spend is not entered (so the report
 * shows nothing rather than a fabricated $0) or when there are no leads. When a value is
 * returned it is ALWAYS presented with the gold assumption badge (planning figure, not a
 * Farmers-published number — guardrail 3).
 */
export function costPerLead(spend: number | null | undefined, leads: number): number | null {
  if (spend == null || !(spend > 0)) return null
  if (!leads || leads <= 0) return null
  return spend / leads
}

// ── Dashboard rollups (across ALL workshops for the year) ───────────────────────

export interface WorkshopLite {
  workshop_id: string
  status?: string | null
  delivery_mode?: string | null
  scheduled_at?: string | null
}

export interface DashboardTiles {
  upcoming: number
  totalRegistrations: number
  /** mean of per-workshop attendance rate across completed/scheduled workshops, 0..1. */
  avgAttendanceRate: number
  avgNoShowRate: number
  consultsBooked: number
}

/**
 * Top-line dashboard tiles across a set of workshops. `nowIso` is passed in (never read
 * from the clock here) so the function stays pure + deterministically testable.
 * Attendance/no-show averages are computed per-workshop then averaged (equal weight per
 * event), so a single huge event doesn't dominate the rate the FSA reads.
 */
export function computeDashboardTiles(
  workshops: WorkshopLite[],
  perWorkshop: Map<string, AttendanceStats>,
  perWorkshopConsults: Map<string, ConsultConversion>,
  nowIso: string,
): DashboardTiles {
  const now = Date.parse(nowIso)
  let upcoming = 0
  let totalRegistrations = 0
  let consultsBooked = 0
  const attRates: number[] = []
  const noShowRates: number[] = []

  for (const w of workshops) {
    const scheduled = w.scheduled_at ? Date.parse(w.scheduled_at) : NaN
    const isCancelled = w.status === 'cancelled'
    if (!isCancelled && !Number.isNaN(scheduled) && scheduled >= now) upcoming++
    const stats = perWorkshop.get(w.workshop_id)
    if (stats) {
      totalRegistrations += stats.registrations
      // only workshops with at least one registration inform the average rates.
      if (stats.registrations > 0) {
        attRates.push(stats.attendanceRate)
        noShowRates.push(stats.noShowRate)
      }
    }
    const consults = perWorkshopConsults.get(w.workshop_id)
    if (consults) consultsBooked += consults.consultsBooked
  }

  return {
    upcoming,
    totalRegistrations,
    avgAttendanceRate: mean(attRates),
    avgNoShowRate: mean(noShowRates),
    consultsBooked,
  }
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

// ── Per-presenter / per-fund-family performance rollup (the repeated decision) ──

export interface PresenterPerf {
  key: string
  label: string
  workshops: number
  registrations: number
  attended: number
  consultsBooked: number
  attendanceRate: number
  /** consultsBooked / registrations — "which wholesaler's events actually convert". */
  conversionRate: number
}

export interface WorkshopRollupInput {
  workshop_id: string
  /** grouping key + label (fund family or presenter name). */
  groups: { key: string; label: string }[]
  stats: AttendanceStats
  consults: ConsultConversion
}

/**
 * Roll up performance by presenter or fund family across the year. A workshop with
 * multiple presenters/fund-families contributes to each group it touches (so a co-hosted
 * event credits both wholesalers). Groups with no key collapse under 'internal'.
 */
export function rollupByGroup(inputs: WorkshopRollupInput[]): PresenterPerf[] {
  const map = new Map<string, PresenterPerf>()
  for (const w of inputs) {
    const groups = w.groups.length ? w.groups : [{ key: 'internal', label: 'Internal / no presenter' }]
    for (const g of groups) {
      const row =
        map.get(g.key) ??
        {
          key: g.key,
          label: g.label,
          workshops: 0,
          registrations: 0,
          attended: 0,
          consultsBooked: 0,
          attendanceRate: 0,
          conversionRate: 0,
        }
      row.workshops++
      row.registrations += w.stats.registrations
      row.attended += w.stats.attended + w.stats.leftEarly
      row.consultsBooked += w.consults.consultsBooked
      map.set(g.key, row)
    }
  }
  const rows = [...map.values()]
  for (const r of rows) {
    r.attendanceRate = ratio(r.attended, r.registrations)
    r.conversionRate = ratio(r.consultsBooked, r.registrations)
  }
  return rows.sort((a, b) => b.conversionRate - a.conversionRate || b.registrations - a.registrations)
}

// ── Formatting helpers (shared by report + dashboard UI) ────────────────────────

/** Render a 0..1 ratio as a whole-percent string, e.g. 0.246 -> "25%". */
export function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`
}
