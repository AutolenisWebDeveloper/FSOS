import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/supabase/client'
import { configErrorResponse, readJson } from '@/lib/http'
import { requireApiRole, requirePermission, actorOf } from '@/lib/auth/api'
import { writeAudit } from '@/lib/audit/log'
import { NigoAnalyzeSchema } from '@/lib/validation/schemas'
import { GatewayDisabledError } from '@/lib/ai/gateway'
import {
  AuthorityType,
  NigoValidity,
  RetrievedChunk,
  GROUNDING_SYSTEM,
  INSUFFICIENT,
  highestAuthority,
  isAuthorityType,
  isValidity,
  renderChunks,
  retrieveChunks,
  runJson,
  verifyCitations,
} from '@/lib/compliance/intelligence'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Compliance Intelligence — the NIGO analysis engine (blueprint §3, Prompt 3).
// POST { nigo_text, product?, carrier?, state?, work_item?, client_ref?, reviewer? }
// Runs the 9-step pipeline: PARSE → RETRIEVE → CLASSIFY AUTHORITY → VALIDATE →
// REVIEW/EXPLAIN → DRAFT → CITE+VERIFY GATE → LOG. Every conclusion is grounded in
// and cited to a retrieved knowledge chunk; ungrounded claims are stripped by the
// verify gate (no invention). Persists to nigo_cases + nigo_issues (the memory).

const WRITE_ROLES = ['fsa', 'licensed_staff', 'super_admin'] as const

interface ParsedIssue {
  seq: number
  issue_text: string
}

interface IssueAnalysis {
  validity: string
  authority_type: string | null
  explanation: string
  whats_wrong: string
  what_to_fix: string
  draft_artifact: string
  citations: string[]
}

export async function POST(req: NextRequest) {
  const auth = await requireApiRole('fsa')
  if (!auth.ok) return auth.response
  const denied = requirePermission(auth.session, [...WRITE_ROLES])
  if (denied) return denied

  const parsed = await readJson(req, 200_000)
  if ('error' in parsed) return parsed.error
  const v = NigoAnalyzeSchema.safeParse(parsed.data)
  if (!v.success) {
    return NextResponse.json({ error: 'Invalid input', details: v.error.flatten() }, { status: 400 })
  }
  const input = v.data

  try {
    const db = getDb()
    const actor = actorOf(auth.session)

    // ── STEP 1: PARSE — split the NIGO into discrete issues ────────────────────
    const parseSystem =
      'You split a NIGO ("Not In Good Order") notice into its discrete, individually-actionable issues. ' +
      'One NIGO often contains 3-5 separate requests. Do not analyze or judge them — only separate them. ' +
      'Output ONLY JSON: {"issues":[{"seq":1,"issue_text":"..."}]}. Preserve the reviewer\'s wording.'
    const parseUser = `NIGO text:\n"""${input.nigo_text}"""`
    const parseOut = await runJson<{ issues?: ParsedIssue[] }>(parseSystem, parseUser, 2000)
    let issues: ParsedIssue[] = Array.isArray(parseOut?.issues) ? parseOut!.issues! : []
    if (!issues.length) issues = [{ seq: 1, issue_text: input.nigo_text.trim() }]
    issues = issues
      .map((it, i) => ({ seq: Number(it.seq) || i + 1, issue_text: String(it.issue_text || '').trim() }))
      .filter((it) => it.issue_text)

    // ── Create the case record (the memory) ────────────────────────────────────
    let caseId = input.case_id ?? null
    if (caseId) {
      const { data: existing } = await db
        .from('nigo_cases')
        .select('id, round_number')
        .eq('id', caseId)
        .maybeSingle()
      if (existing) {
        await db
          .from('nigo_cases')
          .update({ round_number: (existing.round_number ?? 1) + 1, updated_by: actor })
          .eq('id', caseId)
      } else {
        caseId = null
      }
    }
    if (!caseId) {
      const { data: created, error: caseErr } = await db
        .from('nigo_cases')
        .insert({
          work_item: input.work_item ?? null,
          client_ref: input.client_ref ?? null,
          product: input.product ?? null,
          carrier: input.carrier ?? null,
          reviewer: input.reviewer ?? null,
          state: input.state ?? null,
          raw_nigo_text: input.nigo_text,
          created_by: actor,
          updated_by: actor,
        })
        .select('id')
        .single()
      if (caseErr || !created) {
        return NextResponse.json({ error: caseErr?.message ?? 'Failed to create case' }, { status: 500 })
      }
      caseId = created.id
    }

    // ── Per-issue: RETRIEVE → CLASSIFY → VALIDATE → EXPLAIN → DRAFT → VERIFY ────
    const resultIssues = []
    for (const issue of issues) {
      // STEP 2: RETRIEVE across authority tiers
      const chunks: RetrievedChunk[] = await retrieveChunks(issue.issue_text, {
        product: input.product,
        state: input.state,
        limit: 8,
      })

      // STEP 3: CLASSIFY — the highest tier actually present among matches
      const retrievedTop: AuthorityType | null = highestAuthority(chunks)

      // STEP 4-7: VALIDATE + EXPLAIN + DRAFT (grounded ONLY in retrieved chunks)
      const analyzeSystem = GROUNDING_SYSTEM
      const analyzeUser = [
        'Analyze ONE NIGO issue using ONLY the knowledge-library passages below.',
        '',
        `NIGO ISSUE: """${issue.issue_text}"""`,
        input.product ? `PRODUCT: ${input.product}` : '',
        input.carrier ? `CARRIER: ${input.carrier}` : '',
        input.state ? `STATE: ${input.state}` : '',
        '',
        'KNOWLEDGE LIBRARY PASSAGES (the ONLY authority you may cite):',
        renderChunks(chunks),
        '',
        'Return ONLY this JSON object:',
        '{',
        '  "validity": "valid|partially_valid|duplicative|inconsistent|unsupported|needs_clarification",',
        '  "authority_type": "FINRA_RULE|SEC_RULE|STATE_REQUIREMENT|CARRIER_REQUIREMENT|FORM_INSTRUCTION|FFS_PROCEDURE|SUITABILITY_STANDARD|INTERNAL_PREFERENCE|null",',
        '  "explanation": "why the reviewer raised this, in plain English",',
        '  "whats_wrong": "what is missing/incomplete/inaccurate/inconsistent in the file",',
        '  "what_to_fix": "exactly what to correct, revise, complete, clarify, add, or remove",',
        '  "draft_artifact": "the drafted response/correction/clarification/escalation text appropriate to the validity",',
        '  "citations": ["the exact section_ref or chunk id of each passage you relied on — copied verbatim from a passage above"]',
        '}',
        '',
        'RULES:',
        '- authority_type = the HIGHEST tier among the passages that ACTUALLY states this requirement. If no passage states it, authority_type=null and validity=unsupported.',
        '- valid = a passage states the requirement AND the file fails it. partially_valid = the request overreaches what the passage requires. duplicative = already answered. inconsistent = contradicts another item/approval. unsupported = no passage supports it. needs_clarification = cannot tell without more info.',
        '- draft_artifact for unsupported: politely request the specific rule/procedure/form citation behind the request. For valid: state the correction + a hardened, cited explanation. Never include a product recommendation or call to action.',
        '- Cite ONLY passages shown above. Never output a rule number that is not in a passage above.',
      ]
        .filter(Boolean)
        .join('\n')

      const analysis = await runJson<IssueAnalysis>(analyzeSystem, analyzeUser, 2500)

      // STEP 8: CITE + VERIFY GATE — strip any citation not traceable to a chunk
      const rawCitations = Array.isArray(analysis?.citations) ? analysis!.citations.map(String) : []
      const { grounded, stripped } = verifyCitations(rawCitations, chunks)

      let validity: NigoValidity = isValidity(analysis?.validity) ? (analysis!.validity as NigoValidity) : 'needs_clarification'
      // Authority the model claims, constrained to what retrieval actually supports.
      let authority: AuthorityType | null =
        analysis && isAuthorityType(analysis.authority_type) ? (analysis.authority_type as AuthorityType) : null
      if (authority && retrievedTop === null) {
        // Model asserted a tier with nothing retrieved to support it → unsupported.
        authority = null
        validity = 'unsupported'
      }
      if (chunks.length === 0) {
        authority = null
        if (validity === 'valid' || validity === 'partially_valid') validity = 'unsupported'
      }

      const verifyNote =
        stripped.length || (chunks.length === 0)
          ? `${INSUFFICIENT}${stripped.length ? ` (removed uncited: ${stripped.join(', ')})` : ''}`
          : null

      const matchedIds = chunks.map((c) => c.id)

      // STEP 9: LOG — persist the issue analysis
      const { data: issueRow } = await db
        .from('nigo_issues')
        .insert({
          case_id: caseId,
          seq: issue.seq,
          issue_text: issue.issue_text,
          matched_chunk_ids: matchedIds,
          citations: grounded,
          authority_type: authority,
          validity,
          explanation: analysis?.explanation ?? null,
          whats_wrong: analysis?.whats_wrong ?? null,
          what_to_fix: analysis?.what_to_fix ?? null,
          draft_artifact: analysis?.draft_artifact ?? null,
        })
        .select('id')
        .single()

      resultIssues.push({
        id: issueRow?.id ?? null,
        seq: issue.seq,
        issue_text: issue.issue_text,
        authority_type: authority,
        validity,
        explanation: analysis?.explanation ?? '',
        whats_wrong: analysis?.whats_wrong ?? '',
        what_to_fix: analysis?.what_to_fix ?? '',
        draft_artifact: analysis?.draft_artifact ?? '',
        citations: grounded,
        verify_note: verifyNote,
        retrieved: chunks.map((c) => ({
          authority_type: c.authority_type,
          section_ref: c.section_ref,
          title: c.title,
          verbatim: c.verbatim,
        })),
      })
    }

    await writeAudit({
      actor,
      action: 'ai.action',
      entity: 'nigo_case',
      entityId: caseId,
      diff: { issues: resultIssues.length, product: input.product ?? null, carrier: input.carrier ?? null },
    })

    return NextResponse.json({ case_id: caseId, issues: resultIssues })
  } catch (e) {
    if (e instanceof GatewayDisabledError) {
      return NextResponse.json({ error: e.message, code: 'ai_disabled' }, { status: 503 })
    }
    return configErrorResponse(e) ?? NextResponse.json({ error: 'Analysis failed' }, { status: 500 })
  }
}
