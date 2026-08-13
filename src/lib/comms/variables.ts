// src/lib/comms/variables.ts
// ─────────────────────────────────────────────────────────────────────────────
// CENTRALIZED PERSONALIZATION VARIABLE REGISTRY — the single source of truth for
// every merge variable used across FSOS communications (email, SMS, AI conversations,
// appointment messages, advisor scripts, campaign templates).
//
// One registry, one resolution path: templates reference a variable in ANY casing
// (`{{FirstName}}`, `{{first_name}}`, `{{firstName}}`) and the ONE engine
// (personalize.ts) resolves it at send time from an authoritative source. There is no
// second engine and no per-campaign variable logic — a campaign supplies the source
// entities (contact / agent-of-record / policy) to `buildRecipientContext()` and every
// variable resolves identically everywhere.
//
// Validation is per-variable (§13, §4.3):
//   • COSMETIC variables degrade to a safe neutral (a missing first name → "there") and
//     never block a send.
//   • BLOCKING variables are factual/identity values that must resolve — a referenced
//     one that cannot be resolved HARD-BLOCKS the send (unresolvedBlockingTokens in
//     personalize.ts), so a client never receives a raw `{{token}}`, a blank, or a
//     guessed value. Factual data (policy fields, contact details) is NEVER given a
//     fabricated fallback (§4.3).
//
// Authoritative sources:
//   • Advisor / Agency identity + scheduling + reply-to + sender  → src/lib/site.ts (the FSA).
//   • Agent of record (the client's Farmers agent)                → agency_owners (per recipient).
//   • Contact name                                                → the recipient contact/member.
//   • Policy / conversion facts                                   → the policies row (per recipient).
// Relative import (not the `@/` alias) so the offline personalization test-compiles that run
// `tsc` over personalize.ts can follow this dependency chain (site.ts is dependency-free).
import { advisorMergeContext } from '../site'
// The ONE agent-of-record phrasing helper, shared with the platform identity disclosure
// (identity.ts is pure + dependency-free, so importing it here adds no dependency chain).
import { agentOfRecordReference } from './identity'

/** How a referenced-but-unresolved variable is handled. */
export type VarTier = 'cosmetic' | 'blocking'

export interface VariableDef {
  /** Canonical snake_case context key (what the resolution context is keyed by). */
  key: string
  /** Human-facing display name (the "official" spelling shown in the editor). */
  display: string
  tier: VarTier
  /** Short label for the template-editor variable picker. */
  label: string
  /** Blocking URL variables must resolve to an absolute http(s) link (never relative). */
  isUrl?: boolean
  /** Neutral fallback for a COSMETIC variable (ignored for blocking — those fail closed). */
  fallback?: string
  /** Extra accepted spellings beyond the canonical key + display (all matched case/-separator-insensitively). */
  aliases?: string[]
}

// ── The 27 canonical variables ───────────────────────────────────────────────
export const VARIABLES: readonly VariableDef[] = [
  // Contact (cosmetic — degrade gracefully, never block).
  { key: 'first_name', display: 'FirstName', tier: 'cosmetic', label: 'Recipient first name', fallback: 'there' },
  { key: 'last_name', display: 'LastName', tier: 'cosmetic', label: 'Recipient last name', fallback: '' },
  { key: 'full_name', display: 'FullName', tier: 'cosmetic', label: 'Recipient full name', fallback: 'there' },

  // Policy / conversion facts (blocking — never ship a blank or guessed policy value, §4.3).
  { key: 'policy_number', display: 'PolicyNumber', tier: 'blocking', label: 'Policy number' },
  { key: 'policy_type', display: 'PolicyType', tier: 'blocking', label: 'Policy type' },
  { key: 'policy_issue_date', display: 'PolicyIssueDate', tier: 'blocking', label: 'Policy issue date' },
  { key: 'policy_effective_date', display: 'PolicyEffectiveDate', tier: 'blocking', label: 'Policy effective date' },
  { key: 'policy_face_amount', display: 'PolicyFaceAmount', tier: 'blocking', label: 'Policy face amount' },
  { key: 'conversion_expiration_date', display: 'ConversionExpirationDate', tier: 'blocking', label: 'Term-conversion window closes', aliases: ['ConversionDeadline'] },
  { key: 'days_until_conversion_expires', display: 'DaysUntilConversionExpires', tier: 'blocking', label: 'Days until conversion window closes' },
  // The gate on the "no new medical exam" claim (§4.3 / ADR-020): resolves to the claim ONLY
  // when the policy's verified conversion_no_exam flag is true; otherwise the cosmetic fallback
  // renders the always-true neutral phrasing. Cosmetic tier is deliberate — omitting the claim
  // is the safe outcome, so an unverified flag softens the sentence rather than blocking the send.
  { key: 'conversion_exam_clause', display: 'ConversionExamClause', tier: 'cosmetic', label: 'No-exam conversion clause (verified policies only)', fallback: 'subject to the conversion provisions in your policy' },

  // Advisor — the FSA (site.ts). The legacy {{fsa_name}} token stays its own key for backward
  // compatibility (the context builder sets BOTH fsa_name and advisor_name to the FSA), so
  // aliasing here would only risk breaking callers that set fsa_name but not advisor_name.
  { key: 'advisor_name', display: 'AdvisorName', tier: 'blocking', label: 'Advisor (FSA) name' },
  { key: 'advisor_title', display: 'AdvisorTitle', tier: 'blocking', label: 'Advisor title' },
  { key: 'advisor_phone', display: 'AdvisorPhone', tier: 'blocking', label: 'Advisor phone' },
  { key: 'advisor_email', display: 'AdvisorEmail', tier: 'blocking', label: 'Advisor email' },

  // Agent of record — the client's Farmers agent (agency_owners). Names degrade to the approved
  // generic "your Farmers agent" (matching the ADR-016 identity engine); contact details block.
  { key: 'agent_of_record_first_name', display: 'AgentOfRecordFirstName', tier: 'cosmetic', label: 'Agent-of-record first name', fallback: 'your Farmers agent' },
  { key: 'agent_of_record_last_name', display: 'AgentOfRecordLastName', tier: 'cosmetic', label: 'Agent-of-record last name', fallback: '' },
  { key: 'agent_of_record_full_name', display: 'AgentOfRecordFullName', tier: 'cosmetic', label: 'Agent-of-record full name', fallback: 'your Farmers agent' },
  // The phrase campaign copy should use when it names the client's own Farmers agent: reads
  // "your Farmers agent, Jane Smith" when the name is on file and "your Farmers agent" when it
  // is not, so one sentence is correct either way and no guessed name is ever rendered (§4.3).
  { key: 'agent_of_record_reference', display: 'AgentOfRecordReference', tier: 'cosmetic', label: 'Agent-of-record reference phrase', fallback: 'your Farmers agent' },
  { key: 'agent_of_record_phone', display: 'AgentOfRecordPhone', tier: 'blocking', label: 'Agent-of-record phone' },
  { key: 'agent_of_record_email', display: 'AgentOfRecordEmail', tier: 'blocking', label: 'Agent-of-record email' },

  // Agency — the FSA's practice (site.ts).
  { key: 'agency_name', display: 'AgencyName', tier: 'blocking', label: 'Agency name' },
  { key: 'agency_phone', display: 'AgencyPhone', tier: 'blocking', label: 'Agency phone' },
  { key: 'agency_address', display: 'AgencyAddress', tier: 'blocking', label: 'Agency mailing address' },

  // Links + sender identity.
  { key: 'scheduling_link', display: 'SchedulingLink', tier: 'blocking', label: 'Booking link', isUrl: true },
  { key: 'reply_to_email', display: 'ReplyToEmail', tier: 'blocking', label: 'Reply-to inbox' },
  { key: 'sender_name', display: 'SenderName', tier: 'blocking', label: 'Sending party name' },
] as const

// ── Normalization + derived lookup sets ──────────────────────────────────────

/** Fold a token to a comparison key: lowercase, strip every non-alphanumeric (so `FirstName`,
 *  `first_name`, and `first name` all compare equal). */
export function normalizeVarName(raw: string): string {
  return String(raw ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** normalized spelling → canonical key. Built from each variable's key + display + aliases. */
const ALIAS_INDEX: Record<string, string> = (() => {
  const idx: Record<string, string> = {}
  for (const v of VARIABLES) {
    for (const spelling of [v.key, v.display, ...(v.aliases ?? [])]) {
      idx[normalizeVarName(spelling)] = v.key
    }
  }
  return idx
})()

const BY_KEY: Record<string, VariableDef> = Object.fromEntries(VARIABLES.map((v) => [v.key, v]))

/**
 * Resolve a raw template token to its canonical context key. A registered variable (in any
 * casing/separator) maps to its canonical snake_case key; an UNREGISTERED token falls back to
 * `token.toLowerCase()` — exactly the pre-registry behavior, so legacy tokens (e.g. the
 * send-injected `unsubscribe_url`, booking `appointment_time`) keep resolving unchanged.
 */
export function canonicalVarKey(rawToken: string): string {
  const norm = normalizeVarName(rawToken)
  return ALIAS_INDEX[norm] ?? String(rawToken ?? '').toLowerCase()
}

/** Canonical keys of the BLOCKING (fail-closed) variables in the registry. */
export const REGISTRY_BLOCKING_KEYS: readonly string[] = VARIABLES.filter((v) => v.tier === 'blocking').map((v) => v.key)
/** Canonical keys of the blocking URL variables (must resolve to an absolute link). */
export const REGISTRY_URL_KEYS: readonly string[] = VARIABLES.filter((v) => v.isUrl).map((v) => v.key)
/** Canonical key → cosmetic fallback (safe neutral default). */
export const REGISTRY_COSMETIC_DEFAULTS: Record<string, string> = Object.fromEntries(
  VARIABLES.filter((v) => v.tier === 'cosmetic').map((v) => [v.key, v.fallback ?? '']),
)

export function variableDef(key: string): VariableDef | undefined {
  return BY_KEY[key]
}

// ── Formatters (deterministic; a plain `date` string is TZ-free) ──────────────

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** Format a stored `YYYY-MM-DD` (or ISO) date as "Month D, YYYY". Returns null if unparseable. */
export function formatDisplayDate(value: string | null | undefined): string | null {
  const s = String(value ?? '').trim()
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  return `${MONTHS[mo - 1]} ${d}, ${y}`
}

/** Format a numeric/string face amount as USD with no cents ("$500,000"). Null if not a number. */
export function formatMoney(value: string | number | null | undefined): string | null {
  if (value == null || value === '') return null
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[$,]/g, ''))
  if (!Number.isFinite(n)) return null
  return `$${Math.round(n).toLocaleString('en-US')}`
}

/** Whole days from `now` until a `YYYY-MM-DD` deadline (>= 0; 0 if past). Null if unparseable. */
export function daysUntil(deadline: string | null | undefined, nowISO: string): number | null {
  const m = String(deadline ?? '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/)
  const now = Date.parse(nowISO)
  if (!m || Number.isNaN(now)) return null
  const end = Date.parse(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`)
  if (Number.isNaN(end)) return null
  const startDay = Math.floor(now / 86400000)
  const endDay = Math.floor(end / 86400000)
  return Math.max(0, endDay - startDay)
}

// ── The one context builder ───────────────────────────────────────────────────

export interface PersonalizationSources {
  /** The recipient (household member / contact). */
  contact?: { first_name?: string | null; last_name?: string | null; full_name?: string | null } | null
  /** The client's agent of record (agency_owners row for their referring agency). */
  agentOfRecord?: {
    full_name?: string | null
    first_name?: string | null
    last_name?: string | null
    phone?: string | null
    email?: string | null
  } | null
  /** The recipient's policy (policies row) — supplies the policy/conversion facts. */
  policy?: {
    policy_number?: string | null
    policy_type?: string | null
    issue_date?: string | null
    effective_date?: string | null
    face_amount?: string | number | null
    conversion_deadline?: string | null
    /** Verified "conversion requires no new medical exam" flag; null/undefined = unverified. */
    conversion_no_exam?: boolean | null
  } | null
  /** Overrides (rarely needed — identity defaults come from site.ts). */
  scheduling_link?: string | null
  reply_to_email?: string | null
  sender_name?: string | null
  /** ISO "now" for DaysUntilConversionExpires (defaults to the current time at send). */
  now?: string | null
}

function firstOf(full?: string | null): string {
  const s = String(full ?? '').trim()
  return s ? s.split(/\s+/)[0] : ''
}
function lastOf(full?: string | null): string {
  const parts = String(full ?? '').trim().split(/\s+/).filter(Boolean)
  return parts.length > 1 ? parts[parts.length - 1] : ''
}

/** Add a key only when it has a real value — so an absent BLOCKING value fails closed (never a blank). */
function put(ctx: Record<string, string>, key: string, value: string | null | undefined): void {
  const v = String(value ?? '').trim()
  if (v) ctx[key] = v
}

/**
 * Build the personalization context for ONE recipient from the authoritative sources. This is
 * the single place variables are mapped to data — every channel and campaign routes through it,
 * then through personalize.ts. Only RESOLVED values are set; anything unresolved is left out so
 * a referenced blocking variable fails closed rather than shipping a blank/guessed value.
 */
export function buildRecipientContext(sources: PersonalizationSources = {}): Record<string, string> {
  const ctx: Record<string, string> = {}
  const nowISO = sources.now ?? new Date().toISOString()

  // Contact.
  const fullName = sources.contact?.full_name?.trim() || [sources.contact?.first_name, sources.contact?.last_name].filter(Boolean).join(' ').trim()
  put(ctx, 'full_name', fullName)
  put(ctx, 'first_name', sources.contact?.first_name?.trim() || firstOf(fullName))
  put(ctx, 'last_name', sources.contact?.last_name?.trim() || lastOf(fullName))

  // Advisor + agency identity + links (the FSA — always resolvable from site.ts, the ONE source).
  const adv = advisorMergeContext()
  for (const [k, v] of Object.entries(adv)) put(ctx, k, v)
  // Per-send overrides (a delegated/on-behalf-of send may name a different sender / reply-to).
  put(ctx, 'scheduling_link', sources.scheduling_link || adv.scheduling_link)
  put(ctx, 'reply_to_email', sources.reply_to_email || adv.reply_to_email)
  put(ctx, 'sender_name', sources.sender_name || adv.sender_name)

  // Agent of record — the client's Farmers agent (per recipient). Names degrade to the generic
  // "your Farmers agent" via the cosmetic fallback; phone/email block when absent.
  const aor = sources.agentOfRecord
  const aorFull = aor?.full_name?.trim() || [aor?.first_name, aor?.last_name].filter(Boolean).join(' ').trim()
  put(ctx, 'agent_of_record_full_name', aorFull)
  put(ctx, 'agent_of_record_first_name', aor?.first_name?.trim() || firstOf(aorFull))
  put(ctx, 'agent_of_record_last_name', aor?.last_name?.trim() || lastOf(aorFull))
  put(ctx, 'agent_of_record_reference', agentOfRecordReference(aorFull))
  put(ctx, 'agent_of_record_phone', aor?.phone)
  put(ctx, 'agent_of_record_email', aor?.email)

  // Policy / conversion facts (only when a policy source is supplied).
  const p = sources.policy
  if (p) {
    put(ctx, 'policy_number', p.policy_number)
    put(ctx, 'policy_type', p.policy_type)
    put(ctx, 'policy_issue_date', formatDisplayDate(p.issue_date))
    put(ctx, 'policy_effective_date', formatDisplayDate(p.effective_date))
    put(ctx, 'policy_face_amount', formatMoney(p.face_amount))
    put(ctx, 'conversion_expiration_date', formatDisplayDate(p.conversion_deadline))
    const days = daysUntil(p.conversion_deadline, nowISO)
    if (days != null) put(ctx, 'days_until_conversion_expires', String(days))
    // The no-exam claim renders ONLY from the verified flag — strict === true, never truthiness,
    // and never a fallback here: an unresolved clause takes the neutral cosmetic default instead.
    if (p.conversion_no_exam === true) put(ctx, 'conversion_exam_clause', 'with no new medical exam')
  }

  return ctx
}
