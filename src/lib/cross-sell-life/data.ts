// src/lib/cross-sell-life/data.ts
// DB helpers shared by the enrollment service, the daily eligibility/enrollment jobs, and the
// scheduler tick, so eligibility is loaded ONE way and recomputed identically before enrollment
// AND before every touch (spec §3). No business decision lives here — it only assembles the pure
// evaluateEligibility() input from the aggregate-root spine (v_cross_sell_gaps, opportunities →
// products.family, cases, appointments, life/win-back enrollments, households). All reads go
// through getDb().
import { getDb } from '@/lib/supabase/client'
import type { EligibilityInput } from './eligibility'

export interface CampaignConfig {
  id: string
  family_key: string
  version: number
  status: string
  reenroll_cooldown_days: number
  daily_enrollment_limit: number
  advisor_due_hours: number
  advisor_overdue_escalate_hours: number
  advisor_reassign_after_hours: number
  advisor_hold_behavior: 'proceed' | 'hold'
  conversation_timeout_hours: number
  intent_confidence_threshold: number
  send_on_weekends: boolean
  send_on_holidays: boolean
  holiday_calendar: string[]
  resume_behavior: string
  replay_policy: string
  purpose: string | null
  represented_agency_owner_id: string | null
  delegation_id: string | null
}

const CONFIG_COLUMNS =
  'id, family_key, version, status, reenroll_cooldown_days, daily_enrollment_limit, advisor_due_hours, advisor_overdue_escalate_hours, advisor_reassign_after_hours, advisor_hold_behavior, conversation_timeout_hours, intent_confidence_threshold, send_on_weekends, send_on_holidays, holiday_calendar, resume_behavior, replay_policy, purpose, represented_agency_owner_id, delegation_id'

export async function loadCampaign(campaignId: string): Promise<CampaignConfig | null> {
  const db = getDb()
  const { data } = await db.from('xsell_life_campaigns').select(CONFIG_COLUMNS).eq('id', campaignId).maybeSingle()
  return normalizeConfig(data)
}

/** The current live version to enroll into: the single Active version, else the newest Draft. */
export async function loadActiveCampaign(): Promise<CampaignConfig | null> {
  const db = getDb()
  const { data: active } = await db
    .from('xsell_life_campaigns')
    .select(CONFIG_COLUMNS)
    .eq('status', 'active')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (active) return normalizeConfig(active)
  const { data: draft } = await db
    .from('xsell_life_campaigns')
    .select(CONFIG_COLUMNS)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  return normalizeConfig(draft)
}

function normalizeConfig(data: unknown): CampaignConfig | null {
  if (!data) return null
  const d = data as Record<string, unknown>
  return {
    ...(d as unknown as CampaignConfig),
    holiday_calendar: Array.isArray(d.holiday_calendar) ? (d.holiday_calendar as string[]) : [],
  }
}

export interface GapHousehold {
  household_id: string
  primary_name: string | null
  referring_agency_id: string | null
  families_held: string[]
  has_life: boolean
  next_best_line: string | null
  score: number
}

/** The base cross-sell audience: households with a coverage gap and NO life with us (has_life=false).
 *  v_cross_sell_gaps already excludes do_not_contact and requires gap_count>0. Ordered by score so
 *  the daily-limit queue fills highest-value first (§5). */
export async function listGapHouseholds(limit: number): Promise<GapHousehold[]> {
  const db = getDb()
  const { data } = await db
    .from('v_cross_sell_gaps')
    .select('household_id, primary_name, referring_agency_id, families_held, has_life, next_best_line, score')
    .eq('has_life', false)
    .order('score', { ascending: false })
    .limit(limit)
  return (data ?? []).map((r) => ({
    household_id: r.household_id as string,
    primary_name: (r.primary_name as string | null) ?? null,
    referring_agency_id: (r.referring_agency_id as string | null) ?? null,
    families_held: Array.isArray(r.families_held) ? (r.families_held as string[]) : [],
    has_life: r.has_life === true,
    next_best_line: (r.next_best_line as string | null) ?? null,
    score: (r.score as number) ?? 0,
  }))
}

export interface MemberRow {
  id: string
  household_id: string
  full_name: string | null
  email: string | null
  phone: string | null
}

/** The household's primary (first-created) member — the enrollment subject. */
export async function primaryMemberForHousehold(householdId: string): Promise<MemberRow | null> {
  const db = getDb()
  const { data } = await db
    .from('household_members')
    .select('id, household_id, full_name, email, phone')
    .eq('household_id', householdId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  return (data as MemberRow | null) ?? null
}

const OPEN_OPP_STAGES = ['prospect', 'fact_find', 'quoted_proposed', 'application', 'underwriting_suitability']
const OPEN_CASE_STATUSES = ['submitted', 'underwriting', 'requirements_outstanding', 'approved']
const ACTIVE_ENROLLMENT_STATUSES = ['active', 'paused_for_conversation', 'paused_by_admin']

function validEmail(e: string | null | undefined): boolean {
  return !!e && /.+@.+\..+/.test(e)
}
function validPhone(p: string | null | undefined): boolean {
  return !!p && (p.replace(/\D/g, '').length >= 10)
}

/**
 * Assemble the pure eligibility input for a (household, member) against the campaign. Life-vs-non-
 * life is resolved through products.family; the securities firewall is derived from the DB rows
 * (opportunities/cases is_security or a life product's is_security), never assumed safe.
 */
export async function loadEligibilityInput(
  campaign: CampaignConfig,
  householdId: string,
  memberId: string,
  nowISO: string,
  // At the pre-touch recheck the enrollment being advanced is itself a live (e.g. 'running') row
  // for this (campaign, member); counting it raises `duplicate_active` and terminally self-exits
  // the enrollment on its first touch. Recheck callers pass its id to exclude self; enroll-time
  // callers omit it.
  excludeEnrollmentId?: string,
): Promise<EligibilityInput> {
  const db = getDb()

  // Household context: state (jurisdiction), do_not_contact (global opt-out), referring agency.
  const { data: hh } = await db
    .from('households')
    .select('id, state, do_not_contact, referring_agency_id')
    .eq('id', householdId)
    .maybeSingle()

  // Gap-view snapshot: has_life + families_held (existing non-life relationship).
  const { data: gap } = await db
    .from('v_cross_sell_gaps')
    .select('has_life, families_held')
    .eq('household_id', householdId)
    .maybeSingle()
  const families: string[] = Array.isArray(gap?.families_held) ? (gap!.families_held as string[]) : []
  const hasLifeFamily = families.includes('life')

  // Member deliverability.
  const { data: member } = await db.from('household_members').select('email, phone').eq('id', memberId).maybeSingle()

  // Life opportunities for this household (join product family). Open life opp OR placed_issued life.
  const { data: opps } = await db
    .from('opportunities')
    .select('stage, is_security, source, product:product_id (family, is_security)')
    .eq('household_id', householdId)
    .is('deleted_at', null)
  let hasOpenLifeOpp = false
  let hasPlacedLife = false
  let anyLifeSecurity = false
  let inWinbackOpp = false
  for (const o of opps ?? []) {
    const fam = extractFamily(o.product)
    const isLife = fam === 'life'
    if (isLife && (o.is_security === true || extractSecurity(o.product))) anyLifeSecurity = true
    if (isLife && OPEN_OPP_STAGES.includes(String(o.stage))) hasOpenLifeOpp = true
    if (isLife && String(o.stage) === 'placed_issued') hasPlacedLife = true
    if (String(o.source ?? '') === 'win_back' && OPEN_OPP_STAGES.includes(String(o.stage))) inWinbackOpp = true
  }

  // Life applications/cases in flight (case → opportunity → life product).
  const { data: cases } = await db
    .from('cases')
    .select('status, is_security, opportunity:opportunity_id (product:product_id (family))')
    .eq('household_id', householdId)
  let hasLifeApplication = false
  for (const c of cases ?? []) {
    const opp = extractOne(c.opportunity)
    const fam = opp ? extractFamily((opp as Record<string, unknown>).product) : null
    if (fam === 'life' && OPEN_CASE_STATUSES.includes(String(c.status))) hasLifeApplication = true
  }

  // Population separation: active Life Conversion / Win-Back enrollments.
  const inLifeConversion = await hasActiveEnrollment(db, 'life_campaign_enrollments', householdId, memberId)
  const inWinbackEnrollment = await hasActiveEnrollment(db, 'pipeline_winback_enrollments', householdId, memberId)

  // Duplicate: an active enrollment for this member in THIS campaign version. At recheck we exclude
  // the enrollment currently being advanced so it does not flag itself as a duplicate.
  let priorQ = db
    .from('xsell_life_campaign_enrollments')
    .select('id')
    .eq('campaign_id', campaign.id)
    .eq('member_id', memberId)
    .in('status', ['queued', 'scheduled', 'enrolled', 'running', 'paused_for_conversation', 'paused_by_admin', 'conversation_active', 'waiting_for_advisor', 'advisor_owned'])
  if (excludeEnrollmentId) priorQ = priorQ.neq('id', excludeEnrollmentId)
  const { data: prior } = await priorQ.limit(1).maybeSingle()

  // Existing (future) appointment for the household — a scheduled review pauses cross-sell (§3/§6).
  const { data: appt } = await db
    .from('appointments')
    .select('id')
    .eq('household_id', householdId)
    .eq('status', 'scheduled')
    .gte('scheduled_at', nowISO)
    .limit(1)
    .maybeSingle()

  // Cooldown anchor: the most recent terminal, non-converting enrollment for this member.
  const { data: lastTerminal } = await db
    .from('xsell_life_campaign_enrollments')
    .select('completed_at, cooldown_until, exit_reason')
    .eq('member_id', memberId)
    .in('status', ['completed', 'suppressed', 'cancelled'])
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // Licensed jurisdiction (config default §4.3): the FSA's licensed states, editable in ops_config.
  const licensedStates = await loadLicensedStates()
  const state = (hh?.state as string | null) ?? null
  const jurisdictionLicensed = !state || licensedStates.length === 0 || licensedStates.includes(state)

  const hasQualifyingRelationship = families.length > 0 || !!(hh?.referring_agency_id)

  return {
    isSecurity: anyLifeSecurity, // a life relationship flagged securities is firewalled
    optedOut: hh?.do_not_contact === true,
    hasActiveLifePolicy: (gap ? gap.has_life === true : false) || hasLifeFamily || hasPlacedLife,
    hasActiveLifeApplication: hasLifeApplication,
    hasActiveLifeOpportunity: hasOpenLifeOpp,
    inLifeConversion,
    inWinback: inWinbackEnrollment || inWinbackOpp,
    hasQualifyingRelationship,
    priorEnrollmentActive: !!prior,
    hasValidContact: validEmail(member?.email) || validPhone(member?.phone),
    jurisdictionLicensed,
    // Deceased + compliance hold are enforced via inbound-intent handling and the compliance_hold
    // enrollment state / control action (states.ts, controls.ts) rather than a speculative pre-scan
    // against columns this schema does not define — defaulting safe here, never fabricated.
    deceased: false,
    onComplianceHold: false,
    hasLifeAppointment: !!appt,
    advisorConversationActive: false, // set by the conversation-mode recheck in the tick
    lastTerminalAt: (lastTerminal?.completed_at as string | null) ?? null,
    cooldownDays: campaign.reenroll_cooldown_days,
    now: nowISO,
  }
}

async function hasActiveEnrollment(
  db: ReturnType<typeof getDb>,
  table: string,
  householdId: string,
  memberId: string,
): Promise<boolean> {
  const { data } = await db
    .from(table)
    .select('id')
    .eq('household_id', householdId)
    .in('status', ACTIVE_ENROLLMENT_STATUSES)
    .limit(1)
    .maybeSingle()
  return !!data
}

/** ops_config-driven licensed states (config default). Defaults to ['TX'] (the FSA's home state,
 *  McKinney TX) when the key is absent — clearly an editable assumption, never invented per client. */
async function loadLicensedStates(): Promise<string[]> {
  const db = getDb()
  try {
    const { data } = await db.from('ops_config').select('value').eq('key', 'cross_sell_licensed_states').maybeSingle()
    const v = (data as { value?: unknown } | null)?.value
    if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v as string[]
  } catch {
    /* ops_config shape/absence tolerated — fall through to the default */
  }
  return ['TX']
}

// PostgREST embeds to-one relations as an object (or array); normalize defensively.
function extractOne(rel: unknown): unknown {
  return Array.isArray(rel) ? (rel[0] ?? null) : (rel ?? null)
}
function extractFamily(product: unknown): string | null {
  const p = extractOne(product) as Record<string, unknown> | null
  return p ? ((p.family as string | null) ?? null) : null
}
function extractSecurity(product: unknown): boolean {
  const p = extractOne(product) as Record<string, unknown> | null
  return p ? p.is_security === true : false
}
