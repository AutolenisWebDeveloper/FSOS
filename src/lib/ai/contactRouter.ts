// src/lib/ai/contactRouter.ts
// AI contact classification + routing for the Contact Upload feature. For each
// uploaded contact it (1) identifies the contact TYPE (agency owner vs client /
// prospect / term-conversion / cross-sell / business), (2) derives the tags to
// apply, and (3) routes it to the correct AI agent + GHL pipeline.
//
// GUARDRAIL: this is a green-zone "identify" capability only. It classifies who a
// contact is — it NEVER produces a product, policy, investment, or transaction
// recommendation. The prompt is constrained to type classification and the model
// output is validated against a fixed enum; anything else is dropped to 'unknown'.

import { z } from 'zod'
import type { MappedContact } from '@/lib/ghlContacts'
import { runGateway, DEFAULT_MODEL } from '@/lib/ai/gateway'
import type { GhlPipeline } from '@/lib/ghl'

export const CONTACT_TYPES = ['agency_owner', 'client', 'prospect', 'term_conversion', 'cross_sell', 'business', 'unknown'] as const
export type ContactType = (typeof CONTACT_TYPES)[number]

export interface RouteTarget {
  /** AGENT_ROSTER key the contact is routed to. */
  agent: string
  /** GHL pipeline the contact is placed on (null = contacts-only, no opportunity). */
  pipeline: GhlPipeline['key'] | null
  /** Tags applied automatically for this type. */
  tags: string[]
  /** Human label for the UI. */
  label: string
}

// Type → agent + pipeline + tags. Every agent here is green-zone (see roster).
export const ROUTING: Record<ContactType, RouteTarget> = {
  agency_owner: { agent: 'agency_activation', pipeline: 'agency_owner', tags: ['type-owner'], label: 'Agency Owner' },
  client: { agent: 'pipeline', pipeline: 'prospect_client', tags: ['type-client'], label: 'Client' },
  prospect: { agent: 'referral_triage', pipeline: 'prospect_client', tags: ['type-prospect'], label: 'Prospect' },
  term_conversion: { agent: 'term_conversion', pipeline: 'term_conversions', tags: ['term-conversion'], label: 'Term Conversion' },
  cross_sell: { agent: 'cross_sell', pipeline: 'prospect_client', tags: ['cross-sell'], label: 'Cross-Sell' },
  business: { agent: 'pipeline', pipeline: 'prospect_client', tags: ['type-business'], label: 'Business Owner' },
  unknown: { agent: 'data_quality', pipeline: null, tags: ['needs-review'], label: 'Needs Review' },
}

export function routeForType(type: ContactType): RouteTarget {
  return ROUTING[type] ?? ROUTING.unknown
}

export interface Classification {
  type: ContactType
  confidence: number
  reason: string
  method: 'declared' | 'signal' | 'ai' | 'default'
}

// Cheap, deterministic classification from an explicit type/segment column or a
// strong keyword signal. Returns null when the row is ambiguous (→ AI).
function classifyDeterministic(c: MappedContact): Classification | null {
  const declared = (c.declaredType || '').toLowerCase()
  const interest = (c.productInterest || '').toLowerCase()
  const stage = (c.lifeStage || '').toLowerCase()
  const hay = `${declared} ${interest} ${stage}`

  const match = (re: RegExp) => re.test(hay)
  if (declared) {
    if (match(/owner|agency|principal/)) return { type: 'agency_owner', confidence: 0.96, reason: `declared "${c.declaredType}"`, method: 'declared' }
    if (match(/conversion|term\b/)) return { type: 'term_conversion', confidence: 0.95, reason: `declared "${c.declaredType}"`, method: 'declared' }
    if (match(/business|commercial|key\s?person/)) return { type: 'business', confidence: 0.93, reason: `declared "${c.declaredType}"`, method: 'declared' }
    if (match(/cross[-\s]?sell/)) return { type: 'cross_sell', confidence: 0.93, reason: `declared "${c.declaredType}"`, method: 'declared' }
    if (match(/client|customer|policyholder|existing/)) return { type: 'client', confidence: 0.92, reason: `declared "${c.declaredType}"`, method: 'declared' }
    if (match(/prospect|lead|new/)) return { type: 'prospect', confidence: 0.9, reason: `declared "${c.declaredType}"`, method: 'declared' }
  }
  // Product-interest strong signals (no declared type).
  if (match(/term\s?conversion|convert/)) return { type: 'term_conversion', confidence: 0.72, reason: `interest "${c.productInterest}"`, method: 'signal' }
  return null
}

const AiRowSchema = z.object({ index: z.number(), type: z.string(), confidence: z.number().optional(), reason: z.string().optional() })
const AiResponseSchema = z.object({ contacts: z.array(AiRowSchema) })

const CHUNK = 40
const MAX_AI_CONTACTS = 400 // hard cap so an upload can't run away on model cost

export interface ClassifyOutput {
  classifications: Classification[] // aligned to the input contacts array
  aiUsed: boolean
  aiCapped: number // ambiguous contacts left unclassified by the cap (→ unknown)
  model: string
  inputTokens: number
  outputTokens: number
  costUsd: number
}

/**
 * Classify a batch of contacts. Deterministic first; ambiguous rows go to the AI
 * gateway (green-zone identify). Degrades gracefully: if the gateway is disabled
 * (kill switch) or errors, ambiguous rows fall back to 'unknown' and the upload
 * still proceeds.
 */
export async function classifyContacts(contacts: MappedContact[]): Promise<ClassifyOutput> {
  const classifications: Classification[] = new Array(contacts.length)
  const ambiguous: number[] = []

  contacts.forEach((c, i) => {
    const det = classifyDeterministic(c)
    if (det) classifications[i] = det
    else ambiguous.push(i)
  })

  let aiUsed = false
  let aiCapped = 0
  let model = DEFAULT_MODEL
  let inputTokens = 0
  let outputTokens = 0
  let costUsd = 0

  const toAsk = ambiguous.slice(0, MAX_AI_CONTACTS)
  aiCapped = ambiguous.length - toAsk.length

  for (let start = 0; start < toAsk.length; start += CHUNK) {
    const chunk = toAsk.slice(start, start + CHUNK)
    const rows = chunk.map((i) => {
      const c = contacts[i]
      return { index: i, name: c.label, email: c.email ?? '', company: c.customFields['owner_agency_name'] ?? '', product_interest: c.productInterest ?? '', life_stage: c.lifeStage ?? '', tags: c.tags.join(',') }
    })

    try {
      const res = await runGateway({
        agentKey: 'contact_router',
        maxTokens: 1200,
        system:
          'You classify insurance/financial-services CRM contacts by TYPE only. ' +
          'Allowed types: agency_owner (a Farmers agency owner/principal we partner with), ' +
          'client (an existing policyholder/customer), prospect (a new lead/potential client), ' +
          'term_conversion (a term-life policyholder near a conversion window), ' +
          'cross_sell (an existing client with a coverage gap to review), ' +
          'business (a business owner / commercial contact), or unknown. ' +
          'You NEVER recommend any product, policy, investment, allocation, or transaction — ' +
          'you only identify who the contact is. Reply with STRICT JSON only.',
        messages: [
          {
            role: 'user',
            content:
              'Classify each contact. Return JSON: {"contacts":[{"index":<n>,"type":"<one of the allowed types>","confidence":<0..1>,"reason":"<short>"}]}.\n\n' +
              JSON.stringify(rows),
          },
        ],
      })
      aiUsed = true
      model = res.model
      inputTokens += res.usage.inputTokens
      outputTokens += res.usage.outputTokens
      costUsd += res.costUsd

      const s = res.text.indexOf('{')
      const e = res.text.lastIndexOf('}')
      const parsed = s !== -1 && e !== -1 ? AiResponseSchema.safeParse(JSON.parse(res.text.slice(s, e + 1))) : null
      if (parsed?.success) {
        for (const row of parsed.data.contacts) {
          if (!chunk.includes(row.index)) continue
          const t = (CONTACT_TYPES as readonly string[]).includes(row.type) ? (row.type as ContactType) : 'unknown'
          classifications[row.index] = { type: t, confidence: typeof row.confidence === 'number' ? Math.max(0, Math.min(1, row.confidence)) : 0.6, reason: (row.reason || 'AI classification').slice(0, 200), method: 'ai' }
        }
      }
    } catch (err) {
      // Kill switch or provider failure — leave this chunk to the default below.
      console.error('[contactRouter] AI classify failed:', err instanceof Error ? err.message : err)
    }
  }

  // Anything still unset (ambiguous + no AI result, or over the cap) → unknown.
  for (let i = 0; i < contacts.length; i++) {
    if (!classifications[i]) classifications[i] = { type: 'unknown', confidence: 0.3, reason: aiUsed ? 'not classified' : 'AI unavailable', method: 'default' }
  }

  return { classifications, aiUsed, aiCapped, model, inputTokens, outputTokens, costUsd }
}
