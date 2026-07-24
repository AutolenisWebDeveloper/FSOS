// src/lib/fna/household-fna.ts
// Legacy-port FNA Generator — FSOS-spine implementation (docs/legacy-port.md §2.1).
// This REPLACES the legacy src/lib/fna.ts (which read the legacy customers/
// form_submissions tables and called the Anthropic SDK directly). Here we:
//   • read the aggregate-root spine: households, household_members (DOB via the
//     member_dob SECURITY DEFINER RPC — never raw ciphertext), household_policies,
//     coverages;
//   • route the model call through lib/ai/gateway.ts (never a provider SDK);
//   • force the FINRA disclaimer verbatim and screen the output with
//     lib/fna/screen.ts before it may be saved or delivered.
//
// GUARDRAIL 1 (securities firewall): if the household holds any is_security
// product, the report is marked ffs_managed and the securities portion routes to
// FFS — it is NOT generated here. GUARDRAIL 2 (green-zone): needs/gaps only, no
// individualized product recommendation. GUARDRAIL 3: no invented Farmers data.

import { getDb } from '@/lib/supabase/client'
import { dobKey } from '@/lib/data/query'
import { runGateway } from '@/lib/ai/gateway'
import { screenFnaReport, withDisclaimer, type FnaReport, type FnaBlockReason } from './screen'

export interface FnaContextMember {
  full_name: string
  relationship: string | null
  age: number | null
}

export interface FnaContextPolicy {
  policy_number: string | null
  status: string
  is_with_us: boolean
  is_security: boolean
  premium: number | null
  conversion_deadline: string | null
  face_amount: number | null
  detail: string | null
}

export interface FnaContext {
  household_id: string
  primary_name: string
  city: string | null
  state: string | null
  members: FnaContextMember[]
  policies: FnaContextPolicy[]
  hasSecurities: boolean
}

export type FnaGenerateResult =
  | { ok: true; report: FnaReport; hasSecurities: boolean }
  | { ok: false; kind: 'blocked'; reasons: FnaBlockReason[]; report: FnaReport }
  | { ok: false; kind: 'not_found' | 'no_data' | 'ai_error' | 'error'; message: string }

/** Years between an ISO date and now, or null when unknown. */
function ageFromDob(dob: string | null): number | null {
  if (!dob) return null
  const d = new Date(dob)
  if (Number.isNaN(d.getTime())) return null
  const now = new Date()
  let age = now.getFullYear() - d.getFullYear()
  const m = now.getMonth() - d.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1
  return age >= 0 && age < 130 ? age : null
}

/**
 * Assemble the (non-substantive) household context an FNA reads from. DOB is
 * decrypted only through the member_dob RPC and immediately reduced to an age —
 * no date-of-birth or ciphertext leaves this function.
 */
export async function loadFnaContext(householdId: string): Promise<FnaContext | { error: FnaGenerateResult }> {
  const db = getDb()

  const { data: hh, error: hhErr } = await db
    .from('households')
    .select('id, primary_name, city, state')
    .eq('id', householdId)
    .is('deleted_at', null)
    .maybeSingle()
  if (hhErr) return { error: { ok: false, kind: 'error', message: hhErr.message } }
  if (!hh) return { error: { ok: false, kind: 'not_found', message: 'Household not found' } }

  const { data: memberRows } = await db
    .from('household_members')
    .select('id, full_name, relationship')
    .eq('household_id', householdId)
    .is('deleted_at', null)

  const key = dobKey()
  // Decrypt each member's DOB via the SECURITY DEFINER RPC (the app never selects
  // dob_enc directly), CONCURRENTLY — the calls are independent, so we don't
  // serialize one round-trip per member on the generation path.
  const members: FnaContextMember[] = await Promise.all(
    (memberRows ?? []).map(async (m) => {
      let age: number | null = null
      try {
        const { data: dob } = await db.rpc('member_dob', { p_id: m.id, p_key: key })
        age = ageFromDob(typeof dob === 'string' ? dob : null)
      } catch {
        /* DOB unavailable → age stays null; the FNA still runs on the rest. */
      }
      return { full_name: m.full_name, relationship: m.relationship ?? null, age }
    }),
  )

  const { data: policyRows } = await db
    .from('household_policies')
    .select('id, policy_number, status, is_with_us, is_security, premium, conversion_deadline')
    .eq('household_id', householdId)
    .is('deleted_at', null)

  const policyIds = (policyRows ?? []).map((p) => p.id)
  const coverageByPolicy = new Map<string, { detail: string | null; face_amount: number | null }>()
  if (policyIds.length > 0) {
    const { data: covRows } = await db
      .from('coverages')
      .select('policy_id, detail, face_amount')
      .in('policy_id', policyIds)
    for (const c of covRows ?? []) {
      if (!coverageByPolicy.has(c.policy_id)) {
        coverageByPolicy.set(c.policy_id, { detail: c.detail ?? null, face_amount: c.face_amount ?? null })
      }
    }
  }

  const policies: FnaContextPolicy[] = (policyRows ?? []).map((p) => {
    const cov = coverageByPolicy.get(p.id)
    return {
      policy_number: p.policy_number ?? null,
      status: p.status,
      is_with_us: p.is_with_us,
      is_security: p.is_security,
      premium: p.premium ?? null,
      conversion_deadline: p.conversion_deadline ?? null,
      face_amount: cov?.face_amount ?? null,
      detail: cov?.detail ?? null,
    }
  })

  return {
    household_id: hh.id,
    primary_name: hh.primary_name,
    city: hh.city ?? null,
    state: hh.state ?? null,
    members,
    policies,
    hasSecurities: policies.some((p) => p.is_security),
  }
}

const SYSTEM_PROMPT = `You are preparing a Financial Needs Analysis (FNA) for a Farmers Financial Solutions review.

COMPLIANCE — NON-NEGOTIABLE:
- EDUCATIONAL and INFORMATIONAL only. This is NOT a product recommendation or a suitability determination.
- Identify NEEDS and GAPS only. Do NOT tell the client to buy, purchase, invest in, convert, replace, roll over, or allocate anything.
- Do NOT name any specific product, carrier, fund, or policy to buy. Product CATEGORIES (e.g. "Life Insurance", "Annuities / Retirement") are acceptable; specific products are NOT.
- Do NOT make investment, securities, or insurance suitability determinations. All actual recommendations require a licensed FSA meeting and FINRA Reg BI review.
- Never use call-to-action phrasing like "you should buy", "we recommend", "the best product for you", or "put your money in".
- If any securities holding is present it is managed by FFS — do NOT analyze securities accounts, holdings, or allocations here.

Return ONLY valid JSON (no markdown fences, no preamble). Use this exact shape:
{
  "executive_summary": "2-3 sentences on the household's situation and primary NEEDS (not recommendations)",
  "financial_position": "Paragraph assessing coverage/protection posture from the data provided",
  "gaps": ["Concrete coverage/discussion gap 1", "gap 2", "gap 3"],
  "recommendations": [
    { "priority": 1, "title": "Short discussion-topic title", "description": "Educational description of the gap and what to DISCUSS — no product named, no call to action", "product_category": "Life Insurance|Annuities / Retirement|IRA / Mutual Funds|Financial Planning|Business Planning|Estate Planning" }
  ],
  "next_steps": ["Concrete agenda item for the FSA meeting", "step 2", "step 3"],
  "risk_profile": "Conservative|Moderate|Aggressive|Unknown",
  "urgency": "High|Medium|Low"
}
Do NOT include any calculated dollar figures, gaps, or shortfalls as numbers — those come from the deterministic engine, never from you.`

/**
 * Generate an FNA for a household. Routes through the gateway, forces the FINRA
 * disclaimer, and screens the output. A report containing recommendation language
 * (or missing the disclaimer) is returned as a HARD BLOCK for human escalation —
 * never as a saveable report. Nothing is persisted here (generate → review → save).
 */
export async function generateHouseholdFna(
  householdId: string,
  opts: { notes?: string } = {},
): Promise<FnaGenerateResult> {
  const ctx = await loadFnaContext(householdId)
  if ('error' in ctx) return ctx.error

  if (ctx.members.length === 0 && ctx.policies.length === 0) {
    return { ok: false, kind: 'no_data', message: 'Household has no members or policies to analyze' }
  }

  // Only NON-securities context reaches the model (firewall). Securities holdings
  // are acknowledged as ffs_managed but never described.
  const clientData = {
    household: ctx.primary_name,
    location: [ctx.city, ctx.state].filter(Boolean).join(', ') || null,
    members: ctx.members,
    coverage: ctx.policies
      .filter((p) => !p.is_security)
      .map((p) => ({
        status: p.status,
        with_us: p.is_with_us,
        annual_premium: p.premium,
        face_amount: p.face_amount,
        detail: p.detail,
        conversion_window: p.conversion_deadline,
      })),
    fsa_notes: opts.notes?.trim() || null,
    note: ctx.hasSecurities ? 'Household holds securities managed by FFS — excluded from this analysis.' : undefined,
  }

  let text: string
  try {
    const res = await runGateway({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `HOUSEHOLD DATA:\n${JSON.stringify(clientData, null, 2)}\n\nGenerate the FNA JSON now.` }],
    })
    text = res.text
  } catch (err) {
    console.error('[fna] gateway call failed:', err)
    return { ok: false, kind: 'ai_error', message: 'AI generation failed' }
  }

  let parsed: FnaReport
  try {
    parsed = JSON.parse(text.replace(/```json|```/g, '').trim()) as FnaReport
  } catch {
    console.error('[fna] JSON parse error. Raw output:', text.slice(0, 500))
    return { ok: false, kind: 'ai_error', message: 'Failed to parse AI response' }
  }

  // The AI is NEVER the source of an authoritative figure (§0/§1). Drop any numeric
  // estimate fields the model may have emitted so no unlabeled AI number is screened,
  // returned, or persisted — authoritative numbers come only from the deterministic
  // engine (fna_results), never the narrative.
  delete (parsed as Record<string, unknown>).key_metrics
  delete (parsed as Record<string, unknown>).monthly_retirement_gap

  // Force the disclaimer verbatim (withDisclaimer sets it) and mark the securities
  // firewall, then screen.
  const report = withDisclaimer({ ...parsed, ffs_managed: ctx.hasSecurities })

  const screen = screenFnaReport(report)
  if (!screen.allow) {
    return { ok: false, kind: 'blocked', reasons: screen.reasons, report }
  }

  return { ok: true, report, hasSecurities: ctx.hasSecurities }
}
