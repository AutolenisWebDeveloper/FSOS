---
name: finra-rule-ingestion
description: Ingest authority-tagged regulatory and governing documents (FINRA, FFS, FNWL/carrier, state, and firm rules) into FSOS's knowledge corpus so the Compliance Intelligence module can cite them. Use this whenever the task involves loading or updating rule documents, the seed corpus, knowledge_documents or knowledge_chunks, authority tagging, citation grounding, or the scripts fetch-rules.ts and load-seed-corpus.mjs. Reach for it even when the user just says "add this FINRA rule to the corpus", "refresh the rulebook", or "why can't it cite this regulation" — so authority tagging and the no-invented-data guardrail are applied.
license: Proprietary — internal FSOS use only.
metadata:
  project: FSOS
  subsystem: compliance-intelligence
  guardrails: "2.1, 2.3, 3"
---

# FINRA / Regulatory Corpus Ingestion

Loads governing documents into the retrieval corpus that grounds every conclusion the Compliance Intelligence module makes (CLAUDE.md §3). If the corpus is wrong or unattributed, every downstream citation is wrong — so the whole value of this skill is **fidelity and provenance**, not volume.

## The core principle: grounding, not memory

FSOS never asserts a regulatory fact from model memory. The Compliance Intelligence module answers only from passages that exist in `knowledge_chunks`, each traceable to a `knowledge_documents` row with an **authority tag** (who says so — FINRA vs. FFS firm policy vs. carrier vs. state). This is the retrieval-grounded design in `docs/compliance/objective_standard.md` and the §2.3 "no invented Farmers/FFS data" guardrail applied to rules. When the corpus lacks a rule, the correct output is "not in the corpus", never a plausible-sounding paraphrase.

## Authoritative sources — read, don't duplicate

- **Corpus format & authority model:** `docs/compliance/CORPUS_README.md`, `docs/compliance/objective_standard.md`, `docs/compliance/START_HERE.md`.
- **Loaders:** `scripts/fetch-rules.ts` (run via `npm run fetch:rules`), `scripts/load-seed-corpus.mjs` (run via `npm run load:corpus`).
- **Retrieval + chunking:** `src/lib/knowledge/library.ts`; ingest path `src/lib/compliance/pipeline.ts`.
- **Routes:** `src/app/api/compliance/ingest/route.ts`, `src/app/api/compliance/policies/route.ts`, `src/app/api/compliance/checklist/route.ts`.
- **Schema:** `supabase/migrations/036_compliance_intelligence.sql`, `supabase/migrations/033_comms_inbound_knowledge_campaigns.sql` (knowledge tables), `supabase/migrations/037_compliance_document_pipeline.sql`.

## Ingestion rules

1. **Tag authority on every document.** Each `knowledge_documents` row records its source and authority level. Never load a document untagged — an untagged chunk cannot be cited with a source, which defeats grounding.
2. **Preserve provenance to the passage.** Chunk so that a citation points at a specific, quotable passage (section/paragraph), not a whole PDF. `src/lib/knowledge/library.ts` is the single chunking path — extend it, don't fork it.
3. **Never rewrite the rule.** Store the source text; do not "summarize" or "clean up" regulatory language into the corpus, because the summary becomes an uncited assertion. Summaries belong in analysis output (with a citation back), not in the stored chunk.
4. **Distinguish rule from assumption (§2.3).** Publicly-unverifiable Farmers/FFS specifics (commission splits, conversion windows, carrier rules, API availability) are **config defaults**, not corpus rules — they carry `is_assumption = true` and a "config default — verify" badge (archetype A10). Do not launder an assumption into the corpus as if it were an authority.
5. **Firewall (§2.1).** Governing documents only — no client securities records enter the corpus.

## Working here

- For PDF rule documents, extract with the **pdf** skill first, then ingest.
- Ingest writes to the append-only `audit_log`.
- After loading, verify retrieval actually returns the new passages before declaring the corpus updated (grounding is only real if the chunk is retrievable).

## When NOT to use this skill

- Analyzing a RightBridge suitability report → **rightbridge-pdf-analysis**.
- Drafting NIGO resolutions / running the module → **fsos-nigo-intelligence**.

## Validate before claiming done

- `npm run load:corpus` (or `fetch:rules`) completes; `npm run build` clean; `npm test` green.
- Spot-check: pick a newly loaded rule, confirm the module can retrieve and cite it to the correct authority tag.
