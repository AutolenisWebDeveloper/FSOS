---
name: rightbridge-pdf-analysis
description: Ingest and analyze RightBridge suitability-report PDFs inside FSOS's Compliance Intelligence module. Use this whenever the task involves a RightBridge report, a suitability/best-interest PDF, extracting fields from a RightBridge export, the rightbridge_reports table, or the /api/compliance/rightbridge and /api/compliance/upload endpoints. Reach for it even when the user just says "analyze this suitability PDF", "pull the flags from this RightBridge doc", or "why did RightBridge NIGO this" — so the PDF pipeline, retrieval grounding, and securities firewall are applied.
license: Proprietary — internal FSOS use only.
metadata:
  project: FSOS
  subsystem: compliance-intelligence
  guardrails: "2.1, 2.3, 3"
---

# RightBridge PDF Analysis

Turns a RightBridge suitability-report PDF into structured, citation-grounded findings inside the authorized Compliance Intelligence module (CLAUDE.md §3). This is a **self-review drafting aid**, not a supervisory determination of record.

## How this fits together

Two skills cooperate here — keep the responsibilities separate:

- **pdf** (official Anthropic skill) — the mechanical layer: extract text/tables, read form fields, convert pages to images, OCR scanned reports. Use it for anything about *getting bytes out of the PDF*.
- **rightbridge-pdf-analysis** (this skill) — the FSOS layer: route the extracted content through the compliance pipeline, persist to `rightbridge_reports`, ground findings in the knowledge corpus, and enforce the firewall.

Load **pdf** first for extraction, then apply the FSOS rules below.

## Authoritative sources — read, don't duplicate

- **Server pipeline:** `src/lib/compliance/pipeline.ts` (ingest/parse), `src/lib/compliance/extract.ts` (field extraction), `src/lib/compliance/intelligence.ts` (analysis), `src/lib/compliance/firewall.ts` (securities gate).
- **Routes:** `src/app/api/compliance/rightbridge/route.ts`, `src/app/api/compliance/upload/route.ts`, `src/app/api/compliance/ingest/route.ts`, `src/app/api/compliance/analyze/route.ts`.
- **Schema:** `supabase/migrations/037_compliance_document_pipeline.sql` (rightbridge_reports and the document pipeline), `supabase/migrations/036_compliance_intelligence.sql`.
- **Retrieval:** `src/lib/knowledge/library.ts` — ground every conclusion in `knowledge_chunks`.
- **Context:** `docs/compliance/objective_standard.md`, `docs/compliance/FSOS_Compliance_Intelligence_Blueprint.md`, `CLAUDE.md` §2.1 / §3.
- **Tests:** `tests/compliance-extract.test.mjs`.

## Firewall rules for RightBridge content (§2.1)

RightBridge reports are securities-adjacent, so the firewall is strict:

1. **Store the analysis, not the securities record.** Persist NIGO reasons, missing/deficient fields, deadlines, and the FSA's own draft notes. **Never** persist securities account numbers, order/transaction details, or client-facing securities communications. Strip them in `extract.ts`, not after the fact.
2. **Keep only a non-substantive pointer** to the supervised system (`ffs_case_ref`) when correlation is needed. The system of record stays in FFS.
3. **Ground every finding (§2.3).** A flag or conclusion must cite the passage it came from — either the report text itself or a `knowledge_chunks` rule passage. Never invent a rule threshold or a Farmers/FFS deadline; if it is not in the document or corpus, mark it as a config default to verify (archetype A10) rather than asserting it.
4. **No recommendation (§2.2).** Describe the deficiency and what a good-order submission needs; do not recommend a specific product, replacement, or allocation.

## Working here

- Routes keep `export const dynamic = 'force-dynamic'` / `export const runtime = 'nodejs'`, use `getDb()`, and validate uploads with Zod (size, mime, page count) before parsing.
- Large or scanned reports: convert to images and OCR via the **pdf** skill's scripts rather than assuming a text layer exists.
- Write ingest/analysis events to the append-only `audit_log`.
- `rightbridge_reports` is part of the isolated compliance island — no FK into the `cases` spine (see **fsos-nigo-intelligence**).

## When NOT to use this skill

- Non-RightBridge governing/regulatory documents (FINRA/FFS/carrier rule PDFs) → **finra-rule-ingestion**.
- Generic PDF work with no compliance/suitability angle → just the **pdf** skill.

## Validate before claiming done

- `npm run build` clean; `npm test` (includes `compliance-extract`) green.
- Confirm the extractor drops securities account/order fields, and every persisted finding carries a citation.
