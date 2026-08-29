# ADR-040 — Compliance Intelligence Excision (supersedes ADR-012)

**Status:** Accepted
**Date:** 2026-08-28
**Owner:** FSOS Engineering (authorized by the platform owner / licensed FSA)
**Supersedes:** [ADR-012 — Compliance Intelligence (NIGO-Resolution) Exception](./ADR-012-compliance-intelligence-exception.md)

## Context

ADR-012 (Accepted, 2026-07-21) recorded the platform owner's authorization of the Compliance
Intelligence / NIGO-resolution module at `/app/compliance/intelligence` + `/api/compliance/*`.

In its **Alternatives Considered**, ADR-012 explicitly weighed and **rejected** removing the module
from the repository. That rejection read, verbatim:

> - **Module leaves the repo (treat as the "separate NIGO project").** Rejected: it is owner-authorized for in-repo use, is already isolated with no case-spine coupling, and reuses the FSOS AI gateway, audit, and design system; moving it out would fragment the architecture (§6) for no compliance benefit.

**The platform owner has reversed that decision.** The owner has directed that the Compliance
Intelligence feature be excised from FSOS. This ADR is the record of that reversal and, because the
feature's database schema is deliberately retained, the **only in-repo map to the retained tables**.

The reasoning in ADR-012's rejection is not repudiated as having been wrong when written — the
module was in fact isolated, and that isolation is precisely what made this excision clean. What
changed is the owner's judgment about whether FSOS should carry the capability at all. That is an
owner decision, not an engineering one.

## Decision

1. **The application code for Compliance Intelligence is removed.** The page, its components, its ten
   API routes, and its two exclusive `lib/` modules are deleted. The navigation entry is removed and
   `/app/compliance/intelligence` now returns a natural 404 — no redirect, rewrite, or placeholder.
2. **The database schema is RETAINED IN PLACE.** No migration was created and none was modified. No
   table, column, enum, index, foreign key, RLS policy, or grant was dropped. The seven tables and
   three enums are now **orphaned but intact**, and remain RLS-protected exactly as migrations 036
   and 037 left them.
3. **Storage is retained.** Every object under the feature's prefix in the shared private `documents`
   bucket is kept. No bucket policy was touched. The bucket is shared with the AI Knowledge Library
   and other document features and could not be dropped in any case.
4. **Shared infrastructure survives.** `src/lib/compliance/extract.ts` and `src/lib/compliance/pipeline.ts`
   were reduced, not deleted: the AI Knowledge Library upload path depends on them. The securities
   firewall (`firewall.ts`), the AI green-zone/red-line validator (`guardrail.ts`), `lib/compliance.ts`,
   the compliance-officer surface (`(compliance)/**`, attestations / policies / legal-holds), and the
   Executive Alerts event route were untouched.
5. **ADR-012 is marked superseded and retained**, not deleted, so the authorization history stays auditable.

## Why the schema is retained

- The repository's own standing rule for this situation, `docs/legacy-port.md:127`: *"**Never drop a
  legacy table** in this phase. Retire *UI and routes only*. Data stays for retention/audit (≥7yr).
  Table drops are a separate, later decision."*
- `nigo_cases.raw_nigo_text` and `nigo_issues.response_text` hold verbatim not-in-good-order
  correspondence and the drafted responses to it — records that FINRA Rule 4511 and SEC Rule 17a-4
  reach.
- `docs/compliance/CORPUS_README.md` (removed in this change) directed the FSA to upload the FFS
  compliance manual, WSPs, and FCB bulletins into `compliance_documents`. Any such rows are firm
  supervisory material.
- The `audit_log` trail written by the removed routes is append-only by construction
  (migration `077_audit_log_lockdown.sql`) and survives regardless, under the entity types
  `compliance_document`, `compliance_note`, `compliance_upload`, `nigo_case`, `nigo_issue`,
  and `rightbridge_report`. Dropping the tables would leave those audit rows referencing
  records that no longer exist.

A later decision to archive or drop remains open. It is a separate owner decision under the FFS WSP.

## Retained schema inventory

Created by `supabase/migrations/036_compliance_intelligence.sql` and
`037_compliance_document_pipeline.sql`. **No application code reads or writes any of this.**
All eight foreign keys are internal to this set — there is **no foreign key into the aggregate-root
case spine**, so nothing here can orphan a core table.

### Enums
| Enum | Defined | Values |
|---|---|---|
| `authority_type` | 036:37 | `FINRA_RULE`, `SEC_RULE`, `STATE_REQUIREMENT`, `CARRIER_REQUIREMENT`, `FORM_INSTRUCTION`, `FFS_PROCEDURE`, `SUITABILITY_STANDARD`, `INTERNAL_PREFERENCE` — the authority-tier hierarchy |
| `nigo_validity` | 036:44 | whether a NIGO issue was law-backed, firm policy, or unsupported |
| `compliance_upload_status` | 037:33 | upload/extraction state machine |

### `compliance_documents` (036:53) — the governing-authority corpus
Holds one row per uploaded governing document. `title`; `authority_type` (tier); `source_org`
(FINRA, SEC, TX, FFS, carrier); `section_ref` (citation); `effective_date`; `product_scope[]` and
`state_scope[]` (applicability, `ALL` = wildcard); `carrier`; `verbatim` (false ⇒ paraphrased index,
not primary-source text); `is_assumption` (Farmers/FFS config defaults flagged, never asserted as
fact); `source` (`upload|manual|import|seed`); `file_ref` (storage path); `notes`; created/updated by
+ timestamps. **May contain firm supervisory material (FFS manual, WSPs, FCB bulletins).**

### `compliance_chunks` (036:82) — the retrieval index over those documents
`document_id` → `compliance_documents` (cascade); `chunk_key` (stable corpus id, unique, made the
loader idempotent); `seq`; `authority_type` (denormalized from the parent for tier-aware retrieval);
`section_ref` (precise citation, e.g. `2330(b)(1)(A)`); `title`; `chunk_text` (the passage itself);
`product_scope[]`, `state_scope[]`; `governs_patterns[]` (NIGO patterns the chunk governs);
`verbatim`; `search_tsv` (weighted FTS vector, trigger-maintained); timestamps. Optionally
`embedding vector(1536)` **only if the `vector` extension was present at migration time** (036:110-118
is conditional) — whether it exists in a given database is not determinable from the repository.

### `nigo_cases` (036:146) — one not-in-good-order event
`work_item` (**free-text reference — explicitly NOT a foreign key**, 036:148); `client_ref`
(non-substantive pointer only); `product`; `carrier`; `reviewer`; `state`; **`raw_nigo_text`** (the
verbatim NIGO correspondence); `received_at`; `round_number`; `outcome`
(`open|resolved|rejected|escalated|withdrawn`); `lessons_learned`; `resolved_at`;
`source_upload_id` → `compliance_uploads` (037:137); created/updated by + timestamps.

### `nigo_issues` (036:171) — the individual deficiencies within a case
`case_id` → `nigo_cases` (cascade); `seq`; `issue_text`; `matched_chunk_ids uuid[]` (soft reference
to `compliance_chunks`); `citations text[]` (section refs actually used); `authority_type`
(**NULL ⇒ unsupported by the library** — the module's core signal); `validity`; `explanation`;
`whats_wrong`; `what_to_fix`; `draft_artifact`; `resolution`; **`response_text`** (the drafted reply).
Added by 037:144: `status` (16-state machine from `new` through `resolved`/`closed`); `severity`;
`assigned_to`; `human_reviewed` (the human-in-the-loop confirmation flag); `reviewer_notes`;
`resolved_at`.

### `rightbridge_reports` (036:196) — parsed RightBridge suitability exports
`case_id` → `nigo_cases` (set null); `report_type` (`product_profiler|life_wizard|other`); `title`;
`parsed_fields jsonb`; `scoring_flags jsonb`; `consistency_flags jsonb`; `raw_text`; `source`;
`file_ref`; `uploaded_at`; created_by + timestamps. Added by 037:123: `upload_id` →
`compliance_uploads`; `structured_report jsonb` (sections → questions → answers, each with page ref
and confidence); `extraction_confidence`; `parser_version`; `model_version`.

### `compliance_uploads` (037:41) — the uploaded-file index
`case_id` → `nigo_cases` (set null); `kind` (9-value check constraint); `filename`; **`storage_path`**
(path in the shared private `documents` bucket — these objects are retained); `content_type`;
`size_bytes`; `sha256` (duplicate detection); `status`; `extraction_method`
(`native_pdf|claude_pdf|text|image|none`); `page_count`; `char_count`; `extraction_confidence`;
`low_confidence`; `error`; `report_id` → `rightbridge_reports`; **`parser_version`** and
`model_version` (derived-content provenance); `created_by`; `uploaded_at`; `processed_at`; timestamps.

### `compliance_upload_pages` (037:91) — extracted page text
`upload_id` → `compliance_uploads` (cascade); `page_number` (1-based); `text`; `char_count`;
`low_confidence`; `search_tsv` (trigger-maintained); `created_at`; `unique (upload_id, page_number)`.
**Contains the full text of every document uploaded to the module.**

### Retained `parser_version` values
`compliance_uploads.parser_version` and `rightbridge_reports.parser_version` hold the string
`'fsos-doc-extract-1'`. The constant `PARSER_VERSION` in `src/lib/compliance/extract.ts` is
deliberately retained — it has no live caller, but it is the only in-repo record of what those
persisted values mean.

### RLS (unchanged)
All seven tables have RLS enabled with `<table>_read` / `<table>_write` policies built from the
`is_super()` / `has_role()` helpers defined in migration 010 (036:240-274, 037:168-194).
Read: `compliance`, `supervisor`, `fsa`, `licensed_staff`, `admin`, `ops`. Write: the same minus
`ops`. **Orphaned does not mean unprotected.**

## Consequences

**Positive**
- FSOS carries one less isolated subsystem; the `(compliance)` officer surface and the send path are
  unaffected.
- No data was destroyed, and no migration risk was taken.
- The retention decision stays open and reversible.

**Negative / trade-offs**
- Seven tables and three enums exist with no code path. Without this ADR they would be unexplained;
  this document is that explanation and must not be deleted while the tables remain.
- `src/lib/compliance/` now contains only shared and protected modules despite its name — the
  directory no longer corresponds to a single feature.
- `PARSER_VERSION` is a knowingly-unused export (documented above).

## Related
- ADR-012 (superseded) · ADR-004 (securities firewall) · `docs/legacy-port.md:127` (retention rule)
- `supabase/migrations/036_compliance_intelligence.sql`, `037_compliance_document_pipeline.sql` (unmodified)
- `supabase/migrations/077_audit_log_lockdown.sql` (append-only audit trail)
- `INTELLIGENCE_EXCISION_LEDGER.md` (Phase A inventory + Phase B execution record)
