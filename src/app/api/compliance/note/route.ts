import { NextRequest, NextResponse } from 'next/server'
import { configErrorResponse, readJson } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { ComplianceNoteSchema } from '@/lib/validation/schemas'
import { GatewayDisabledError } from '@/lib/ai/gateway'
import { GROUNDING_SYSTEM, renderChunks, retrieveChunks, runJson } from '@/lib/compliance/intelligence'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Compliance Intelligence — note authoring & hardening (blueprint §4.3, Prompt 5).
// Drafts / strengthens a suitability note against the OBJECTIVE STANDARD (the
// U1-U8 universal elements + product add-ons in docs/compliance/objective_standard.md),
// so the note visibly SHOWS every applicable element and is pre-armored against a
// subjective "not good enough" reviewer. NO product recommendation, NO performance
// projection — this is documentation of the FSA's own basis, not advice.

const WRITE_ROLES = ['fsa', 'licensed_staff', 'super_admin'] as const

// The objective-standard element checklist (kept in-code so the model always
// receives the definition of "good enough"; the source of record is the doc).
const UNIVERSAL_ELEMENTS = [
  'U1 Client profile facts (age, income, net worth, liquid net worth, time horizon, dependents — specific numbers)',
  'U2 Stated objective in the client\'s own terms (not a generic "growth")',
  'U3 Risk tolerance — ONE value, consistent across every document',
  'U4 Basis tied to the objective — WHY this serves THIS client\'s stated goal (causal link)',
  'U5 Client understanding of the product\'s mechanics and risks (not just "agreed")',
  'U6 Reasonably-available alternatives considered and why not chosen',
  'U7 Costs & fees disclosed (specific structure, client informed)',
  'U8 Uniqueness — addresses THIS client\'s circumstances; not a replicated note',
]

const ADDON_ELEMENTS: Record<string, string[]> = {
  va_exchange: [
    'VA1 Loss of existing benefits (living/death benefit value forfeited, quantified)',
    'VA2 Surrender charges on the old contract + any NEW surrender period created',
    'VA3 Fee/cost comparison old vs new (specific)',
    'VA4 36-month prior-exchange check',
    'VA5 Share-class justification',
    'VA6 Liquidity consistency (liquid net worth vs liquidity needs)',
    'VA7 Source of funds (entered consistently)',
    'VA8 Reasonably-available alternatives to the exchange itself',
  ],
  buffered: [
    'B1 Limited protection stated correctly (buffer/floor — NOT full principal protection)',
    'B2 IVA disclosure — transaction-specific (an IVA WILL apply if exiting a segment before maturity; may be +/-)',
    'B3 Cap disclosure (growth is capped)',
    'B4 RightBridge consistency (if IVA applies, the MVA/IVA field = Yes)',
  ],
  exchange_1035: [
    'X1 Tax-free treatment basis (qualifies under IRC 1035; documented)',
    'X2 Loan carryover — WRITTEN ceding-carrier confirmation the loan carries over (else boot → taxable)',
    'X3 Loan entered in the structured field (not just narrative)',
    'X4 New surrender/backend charges disclosed',
  ],
  replacement: [
    'R1 Existing-contract facts VERIFIED (every claim about the old contract is true — a false differentiator is the most dangerous line)',
    'R2 Replacement notice signed & dated by applicant and producer at/before app',
    'R3 Base application face = illustration face',
    'R4 Benefits lost in the replacement, quantified',
  ],
}

export async function POST(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, [...WRITE_ROLES])
  if (denied) return denied

  const parsed = await readJson(req, 200_000)
  if ('error' in parsed) return parsed.error
  const v = ComplianceNoteSchema.safeParse(parsed.data)
  if (!v.success) {
    return NextResponse.json({ error: 'Invalid input', details: v.error.flatten() }, { status: 400 })
  }
  const d = v.data

  // Determine which objective-standard elements apply to this transaction.
  const product = (d.product ?? '').toUpperCase()
  const applicable = [...UNIVERSAL_ELEMENTS]
  const addonKeys: string[] = []
  if (product.includes('VA') || d.transaction_type?.toLowerCase().includes('exchange')) addonKeys.push('va_exchange')
  if (d.is_buffered || product.includes('RILA') || product.includes('BUFFER')) addonKeys.push('buffered')
  if (d.is_exchange_1035) addonKeys.push('exchange_1035')
  if (d.is_replacement) addonKeys.push('replacement')
  for (const k of addonKeys) applicable.push(...ADDON_ELEMENTS[k])

  try {
    // Retrieve the governing chunks behind these elements (for grounded citations).
    const retrievalQuery = [
      d.case_facts,
      product,
      d.transaction_type ?? '',
      ...addonKeys,
      'suitability care obligation alternatives costs surrender replacement',
    ].join(' ')
    const chunks = await retrieveChunks(retrievalQuery, { product: d.product, limit: 10 })

    const system = GROUNDING_SYSTEM
    const user = [
      'Draft a suitability/case note that VISIBLY SHOWS each applicable element of the objective standard below,',
      'using ONLY the case facts provided. "Showing" means tying each element to the specific client facts —',
      'not asserting "client wants X". Do NOT include any product recommendation, call to action, or performance projection.',
      'Describe any buffered/structured protection as LIMITED (never full principal protection).',
      'Include transaction-specific IVA disclosure when applicable.',
      '',
      'CASE FACTS:',
      `"""${d.case_facts}"""`,
      d.existing_note ? `\nEXISTING NOTE TO STRENGTHEN:\n"""${d.existing_note}"""` : '',
      '',
      'APPLICABLE OBJECTIVE-STANDARD ELEMENTS (each must be visibly satisfied):',
      applicable.map((e) => `- ${e}`).join('\n'),
      '',
      'GOVERNING PASSAGES (cite these where relevant; do not invent rule numbers):',
      renderChunks(chunks),
      '',
      'Return ONLY this JSON:',
      '{',
      '  "note": "the drafted/strengthened suitability note",',
      '  "coverage": [{"element":"U1","covered":true,"missing_fact":null}],',
      '  "missing_facts": ["case facts still required to fully satisfy an element"],',
      '  "citations": ["section_ref of any governing passage relied on — copied from a passage above"]',
      '}',
    ]
      .filter(Boolean)
      .join('\n')

    const out = await runJson<{
      note?: string
      coverage?: { element: string; covered: boolean; missing_fact?: string | null }[]
      missing_facts?: string[]
      citations?: string[]
    }>(system, user, 3500)

    if (!out?.note) {
      return NextResponse.json({ error: 'Could not draft note — try adding more case facts.' }, { status: 502 })
    }

    await writeAudit({
      actor: actorOf(auth.session),
      action: 'ai.action',
      entity: 'compliance_note',
      entityId: null,
      diff: { product: d.product ?? null, elements: applicable.length, addons: addonKeys },
    })

    return NextResponse.json({
      note: out.note,
      applicable_elements: applicable,
      coverage: out.coverage ?? [],
      missing_facts: out.missing_facts ?? [],
      citations: out.citations ?? [],
      disclaimer:
        'Draft documentation aid for the licensed FSA’s own review. Not a product recommendation or suitability determination. Requires licensed FSA review per FINRA Reg BI.',
    })
  } catch (e) {
    if (e instanceof GatewayDisabledError) {
      return NextResponse.json({ error: e.message, code: 'ai_disabled' }, { status: 503 })
    }
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Note drafting failed' }, { status: 500 })
  }
}
