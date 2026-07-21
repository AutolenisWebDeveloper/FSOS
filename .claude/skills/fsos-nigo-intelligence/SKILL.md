---
name: fsos-nigo-intelligence
description: Work inside FSOS's authorized Compliance Intelligence / NIGO-resolution module — the retrieval-grounded drafting and analysis aid at /app/compliance/intelligence and /api/compliance/*. Use this whenever a task touches NIGO cases, NIGO issues, not-in-good-order correspondence, suitability draft notes, compliance checklists, the knowledge library, or the isolated compliance tables (nigo_cases, nigo_issues, rightbridge_reports, knowledge_documents, knowledge_chunks). Use it even when the request just says "the compliance intelligence tool", "NIGO tracker", or "resolve this deficiency", so the securities firewall and isolation rules are applied correctly.
license: Proprietary — internal FSOS use only.
metadata:
  project: FSOS
  subsystem: compliance-intelligence
  guardrails: "2.1, 2.3, 3"
---

# FSOS NIGO / Compliance Intelligence

The one place in FSOS where NIGO (not-in-good-order) work is allowed. It is an **owner-authorized, isolated subsystem** (CLAUDE.md §3) — a retrieval-grounded drafting and analysis aid for the FSA's *own* production and supervision workflow, **not** a broker-dealer system of record.

Read this before touching anything under the compliance-intelligence surface, because the constraints here are the inverse of the rest of FSOS: NIGO is *forbidden* on the aggregate-root spine but *authorized* here, and only here.

## Authoritative sources — read, don't duplicate

Reference these; never paste their contents into new files or re-document them.

- **Blueprint & scope:** `docs/compliance/FSOS_Compliance_Intelligence_Blueprint.md`, `docs/compliance/START_HERE.md`, `docs/compliance/objective_standard.md`, `docs/compliance/CORPUS_README.md`.
- **Firewall & guardrail contract:** `CLAUDE.md` §2.1 (authorized-exception note), §3 (scope exclusion + authorization), `docs/data-guardrails.md`.
- **Server logic:** `src/lib/compliance/intelligence.ts` (analysis), `src/lib/compliance/pipeline.ts` (ingest), `src/lib/compliance/extract.ts`, `src/lib/compliance/firewall.ts` (the securities gate), `src/lib/compliance/guardrail.ts`, `src/lib/knowledge/library.ts` (retrieval / chunks / citations).
- **Routes:** `src/app/api/compliance/{ingest,analyze,rightbridge,note,checklist,history,stats,issues,policies,attestations,legal-holds,upload}/route.ts`; UI at `src/app/(fsa)/app/compliance/intelligence/page.tsx`.
- **Schema:** `supabase/migrations/036_compliance_intelligence.sql`, `supabase/migrations/037_compliance_document_pipeline.sql`.
- **Tests:** `tests/compliance.test.mjs`, `tests/compliance-extract.test.mjs`.

## Non-negotiable boundaries

These are why the module was allowed to exist at all — violating one collapses the authorization.

1. **Isolation from the spine.** `nigo_cases` is a self-contained work log keyed by a free-text `work_item`/`client_ref` — **never** a foreign key to `cases`. Do not cross-link into or mutate `agency_partnerships → referrals → households → reviews → opportunities → cases → commissions`. If you find yourself adding a `case_id` FK, stop.
2. **Securities firewall (§2.1).** Never store securities account numbers, order details, or client-facing securities communications. Store only the FSA's own NIGO correspondence, authority-tagged governing documents, and the FSA's own *draft* suitability/case notes for self-review. The supervisory determination of record stays in the FFS-supervised system referenced by `ffs_case_ref`.
3. **Retrieval-grounded, never invented (§2.3).** Every conclusion the module emits must be grounded in and cited to an uploaded library passage (`knowledge_chunks`). It must never invent a rule, citation, deadline, or fact. If the corpus does not support a claim, surface the gap instead of filling it.
4. **No individualized recommendation (§2.2 red line).** The module analyzes and drafts; it does not make a product/investment/replacement recommendation.

## Working here

- Every API route keeps `export const dynamic = 'force-dynamic'` and `export const runtime = 'nodejs'`, uses `getDb()` from `@/lib/supabase/client`, and validates input with Zod (CLAUDE.md §1).
- NIGO writes go through the append-only `audit_log` (`src/lib/audit/`).
- Ingested documents flow through `src/lib/compliance/pipeline.ts` → chunked into `knowledge_chunks` for citation; analysis reads them back via `src/lib/knowledge/library.ts`. Extend that path — do not add a second retrieval mechanism.
- For RightBridge suitability-report PDFs specifically, hand off to the **rightbridge-pdf-analysis** skill.
- For loading regulatory/governing rule documents into the corpus, hand off to the **finra-rule-ingestion** skill.

## When NOT to use this skill

- Anything on the aggregate-root case spine (`/app/cases`) — that surface is deliberately NIGO-free (§3). Use **fsos-crm-workflows** instead.
- General RLS/firewall auditing across FSOS — use **fsos-security-audit**.

## Validate before claiming done

- `npm run build` clean; `npm test` (includes `compliance` + `compliance-extract` gates) green; `npm run test:rls` if you touched RLS on any compliance table.
- Confirm no new FK from `nigo_cases`/`nigo_issues` to the spine, and no securities-prohibited field was added.
- Confirm every emitted conclusion carries a citation to a `knowledge_chunks` row.
