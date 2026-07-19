import { NextRequest, NextResponse } from 'next/server'
import { configErrorResponse, readJson } from '@/lib/http'
import { requireApiRole, requirePermission } from '@/lib/auth/api'
import { ComplianceChecklistSchema } from '@/lib/validation/schemas'
import { GatewayDisabledError } from '@/lib/ai/gateway'
import { GROUNDING_SYSTEM, renderChunks, retrieveChunks, runJson, verifyCitations } from '@/lib/compliance/intelligence'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Compliance Intelligence — paperwork checklist (blueprint §4.2, Prompt 5).
// Given product + carrier + transaction type, retrieve the FORM_INSTRUCTION and
// CARRIER_REQUIREMENT chunks and return the required forms / fields / signatures.
// Grounded only in retrieved passages: when a tier is empty (the FFS/carrier
// stubs), the checklist SAYS the governing doc must be uploaded — it never invents
// a carrier rule it has not seen.

const WRITE_ROLES = ['fsa', 'licensed_staff', 'super_admin'] as const

interface ChecklistOut {
  required_forms?: { form: string; why: string; citation?: string | null }[]
  required_fields?: { field: string; why: string; citation?: string | null }[]
  required_signatures?: { signer: string; document: string; citation?: string | null }[]
  gaps?: string[]
  citations?: string[]
}

export async function POST(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, [...WRITE_ROLES])
  if (denied) return denied

  const parsed = await readJson(req)
  if ('error' in parsed) return parsed.error
  const v = ComplianceChecklistSchema.safeParse(parsed.data)
  if (!v.success) {
    return NextResponse.json({ error: 'Invalid input', details: v.error.flatten() }, { status: 400 })
  }
  const d = v.data

  try {
    const query = [
      d.product,
      d.carrier ?? '',
      d.transaction_type ?? '',
      d.state ?? '',
      'required forms signatures replacement notice application disclosure submission checklist',
    ].join(' ')
    const chunks = await retrieveChunks(query, { product: d.product, state: d.state, limit: 12 })

    const hasCarrier = chunks.some((c) => c.authority_type === 'CARRIER_REQUIREMENT')
    const hasForm = chunks.some((c) => c.authority_type === 'FORM_INSTRUCTION')

    const system = GROUNDING_SYSTEM
    const user = [
      'Produce a required-paperwork checklist for the transaction below, grounded ONLY in the passages provided.',
      '',
      `PRODUCT: ${d.product}`,
      d.carrier ? `CARRIER: ${d.carrier}` : '',
      d.transaction_type ? `TRANSACTION: ${d.transaction_type}` : '',
      d.state ? `STATE: ${d.state}` : '',
      '',
      'GOVERNING PASSAGES:',
      renderChunks(chunks),
      '',
      'Return ONLY this JSON:',
      '{',
      '  "required_forms": [{"form":"name/number","why":"...","citation":"section_ref from a passage or null"}],',
      '  "required_fields": [{"field":"...","why":"...","citation":"... or null"}],',
      '  "required_signatures": [{"signer":"...","document":"...","citation":"... or null"}],',
      '  "gaps": ["what the library is MISSING to give a complete answer — e.g. the carrier submission guide is not uploaded"],',
      '  "citations": ["section_refs relied on — copied from passages above"]',
      '}',
      '',
      `NOTE: carrier-requirement passages ${hasCarrier ? 'ARE' : 'are NOT'} present; form-instruction passages ${hasForm ? 'ARE' : 'are NOT'} present. ` +
        'For any item you cannot ground in a passage, do NOT invent it — instead add a gaps[] entry naming the governing document to upload.',
    ]
      .filter(Boolean)
      .join('\n')

    const out = await runJson<ChecklistOut>(system, user, 2500)
    if (!out) {
      return NextResponse.json({ error: 'Could not build checklist.' }, { status: 502 })
    }

    // Verify gate on the top-level citations.
    const { grounded } = verifyCitations(Array.isArray(out.citations) ? out.citations.map(String) : [], chunks)

    const gaps = [...(out.gaps ?? [])]
    if (!hasCarrier && d.carrier) {
      gaps.push(`No CARRIER_REQUIREMENT document for ${d.carrier} is in the library — upload the carrier submission guide for a complete answer.`)
    }
    if (!hasForm) {
      gaps.push('No FORM_INSTRUCTION documents matched — upload the applicable form instructions for form-level requirements.')
    }

    return NextResponse.json({
      required_forms: out.required_forms ?? [],
      required_fields: out.required_fields ?? [],
      required_signatures: out.required_signatures ?? [],
      gaps,
      citations: grounded,
      tiers_present: { carrier: hasCarrier, form: hasForm },
    })
  } catch (e) {
    if (e instanceof GatewayDisabledError) {
      return NextResponse.json({ error: e.message, code: 'ai_disabled' }, { status: 503 })
    }
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Checklist failed' }, { status: 500 })
  }
}
