# Intelligence Excision Ledger

Append-only. Never rewrite or compact prior entries. Each entry is timestamped.
If context is compacted mid-run, re-read this file and resume from the last completed section.

---

## Entry 1 — Sections 0 + 1 (Branch Guard + Baseline Gate) — 2026-08-28T21:53:23Z

**HEAD SHA:** `ab8198fca3e81e722225e944b27d15369772470c`
**Branch:** `claude/compliance-intelligence-excision-tx5iyi`
**Phase:** A (READ-ONLY inventory). No source file edited, deleted, or refactored this run.

### 0. Branch guard

| Check | Result |
|---|---|
| Current branch | `claude/compliance-intelligence-excision-tx5iyi` |
| HEAD SHA | `ab8198fca3e81e722225e944b27d15369772470c` |
| `git status --porcelain` | **empty — working tree clean** |
| HEAD ancestor of `origin/main`? | **YES** (`git merge-base --is-ancestor` → 0; `rev-list --left-right --count origin/main...HEAD` → `0  0`, i.e. identical) |
| Remote | `https://github.com/AutolenisWebDeveloper/FSOS` |

**GHL excision verified BY CONTENT (not by branch name) — PROVEN:**

| Probe | Result |
|---|---|
| `process.env.*GHL* / *HIGHLEVEL* / *LEADCONNECTOR*` reads in `src/ scripts/ tests/` | **none** |
| API hosts `leadconnectorhq` / `rest.gohighlevel` / `api.gohighlevel` / `msgsndr` | **none** in `src/ scripts/ tests/ supabase/` |
| Live GHL client module imported anywhere | **none** — the only `ghl`-named import is `src/lib/comms/migration/ghl-optout.ts`, a **pure planner with zero imports** (verified: no `import`/`require` lines), consumed solely by the one-time `scripts/ghl-migration/*` tooling |
| `src/lib/pipelines.ts` exists and is the pipeline/stage taxonomy source | **YES** — 8,859 bytes; declares `InternalPipeline`, `PipelineKey`, `Pipeline`, `PipelineStage`, `PIPELINE_PROSPECT_CLIENT` et al. Consumers: `api/agencies/list:4`, `api/scores:4`, `api/search:4`, `api/opra:5`, `api/dashboard:5`, `lib/ai/contactRouter:15`, `lib/customerProfile:6`, plus `tests/pipelines-taxonomy.test.mjs` |

Residual `ghl_*` surface is **dormant, non-executing**: legacy DB columns (`ghl_contact_id`, `ghl_opportunity_id`, `ghl_stage_id`, `ghl_pipeline_id`) read for display only, plus code comments. **Stale-doc note (not a code defect):** `.env.local.example:98-109` still documents `GHL_API_KEY`, `GHL_LOCATION_ID`, `GHL_WEBHOOK_SECRET`, but **no code reads any of them**. Out of scope for this excision; flagged only.

**Working tree was clean, so no STOP condition was triggered.**

### 1. Baseline gate

Environment setup performed (NOT a source change): `node_modules` was absent, so `npm ci --no-audit --no-fund` was run (exit 0, 637 packages). `node_modules` is gitignored; `git status --porcelain` remained empty. No new tooling was installed — only the repo's own declared dependencies from the committed lockfile.

Node v22.22.2 / npm 10.9.7. No `.env.local` present.

| # | Exact command | Exit | Result |
|---|---|---|---|
| 1 | `npm run type-check` (`tsc --noEmit`) | **0** | **PASS** — no type errors |
| 2 | `npm run lint` (`next lint`) | **0** | **PASS** — "No ESLint warnings or errors" |
| 3 | `npm test` (`node scripts/run-tests.mjs unit`) | **0** | **PASS** — "All 192 unit test file(s) passed." |
| 4 | `npm run test:rls` (`node scripts/run-tests.mjs rls`) | **0** | **PASS** — "All 15 rls test file(s) passed." |
| 5 | `npm run build` (`next build`) | **0** | **PASS** — full route manifest emitted, middleware 92.5 kB |

**BASELINE IS FULLY GREEN — 5/5 gates pass.**

- **ENVIRONMENT/TOOLCHAIN failures: NONE.** (The absent `node_modules` was a setup precondition, resolved by `npm ci`; it produced no gate failure.)
- **REPOSITORY failures: NONE.**

Notes that matter for interpreting the post-removal run:
- `next lint` prints a Next.js 16 deprecation warning. It is a **warning, not a failure** (exit 0); expect it again post-removal.
- The build succeeded **without** `.env.local`, so no environment variable is a build-time hard requirement. A post-removal build failure would therefore be attributable to the change, not to missing env.
- Test discovery is a **directory scan** (`scripts/run-tests.mjs:36-39`: every `tests/*.{mjs,mts}`, minus a hard-coded 15-entry `RLS` allowlist). Deleting a test file silently reduces the denominator — post-removal, the count `192` must be reconciled deliberately, not assumed.

---

## Entry 2 — Section 3 (Discovery / true surface area) — 2026-08-28T22:06:43Z

**HEAD SHA:** `ab8198fca3e81e722225e944b27d15369772470c`. Still READ-ONLY; no source touched.

### Resolved route

Deployed `/app/compliance/intelligence` → **`src/app/(fsa)/app/compliance/intelligence/page.tsx`**.
`(fsa)` is a **route group** (parenthesised ⇒ contributes no URL segment); `app/compliance/intelligence` are three **literal** segments. The directory contains **only `page.tsx`** — no nested route, no `layout/loading/error/template/not-found` of its own (verified by listing every ancestor: boundaries come from `src/app/{layout,error,not-found}.tsx` and `src/app/(fsa)/{layout,error,loading}.tsx`, all shared → **PROTECTED, not removable**).

### (a) Page routes and boundaries — PROVEN
- `src/app/(fsa)/app/compliance/intelligence/page.tsx` (24 lines) — server component; renders `<ListShell>` + `<ComplianceIntelligence/>`; `export const dynamic = 'force-dynamic'`.
- No nested routes. No feature-owned boundaries.

### (b) API route handlers — PROVEN by call-site tracing

The `src/app/api/compliance/**` namespace serves **two unrelated consumers**. The split is exact:

**Intelligence-exclusive (10 route files)** — every caller is `src/components/compliance/{ComplianceIntelligence,DocumentUpload,DocumentsTab}.tsx`:

| Route file | Called from | Tables touched |
|---|---|---|
| `analyze/route.ts` (268) | `ComplianceIntelligence.tsx:253` | `compliance_upload_pages`, `nigo_cases`, `nigo_issues` |
| `note/route.ts` (163) | `ComplianceIntelligence.tsx:418` | (retrieval only) |
| `checklist/route.ts` (112) | `ComplianceIntelligence.tsx:711` | (retrieval only) |
| `rightbridge/route.ts` (173) | `ComplianceIntelligence.tsx:553` | `compliance_upload_pages`, `nigo_cases`, `rightbridge_reports`, `nigo_issues`, `compliance_uploads` |
| `ingest/route.ts` (137) | `ComplianceIntelligence.tsx:827,848` | `compliance_documents`, `compliance_chunks` |
| `history/route.ts` (122) | `ComplianceIntelligence.tsx:1042` | `nigo_cases`, `nigo_issues` |
| `stats/route.ts` (106) | `ComplianceIntelligence.tsx:1043` | `nigo_cases`, `nigo_issues` |
| `upload/route.ts` (213) | `DocumentUpload.tsx:108`, `DocumentsTab.tsx:76` | `compliance_uploads`, `nigo_cases` |
| `upload/[id]/route.ts` (187) | `ComplianceIntelligence.tsx:933`, `DocumentsTab.tsx:209,232,253` | `compliance_uploads`, `compliance_upload_pages`, `rightbridge_reports` |
| `issues/[id]/route.ts` (67) | `ComplianceIntelligence.tsx:192` | `nigo_issues` |

**NOT intelligence — PROTECTED (7 route files in the same namespace; do not remove):**

| Route file | Real consumer |
|---|---|
| `attestations/route.ts`, `attestations/[id]/route.ts` | `(compliance)/compliance/attestations/page.tsx:5` via `ComplianceControls.tsx` |
| `policies/route.ts`, `policies/[id]/route.ts` | `(compliance)/compliance/policies/page.tsx:5` via `ComplianceControls.tsx` |
| `legal-holds/route.ts`, `legal-holds/[id]/route.ts` | `(compliance)/compliance/legal-holds/page.tsx:5` via `ComplianceControls.tsx` |
| `events/[id]/route.ts` | `src/components/app/EscalationList.tsx:230` **and** `(fsa)/app/executive/alerts/page.tsx:42` — the Executive Alerts / AI Escalations feed; uses `lib/services/eventDeletion` |

Structural note: `events/` and `issues/` contain **only** an `[id]/route.ts`; neither has a sibling `route.ts`.
**No server actions** are used by this feature — all I/O is `fetch` to the routes above.

### (c) Components / hooks / contexts — PROVEN by inbound import search
- `src/components/compliance/ComplianceIntelligence.tsx` (1168) — sole importer `…/intelligence/page.tsx:2`. Seven tabs (`:22-29`): Analyze NIGO, Harden a Note, RightBridge Check, Paperwork Checklist, Documents, Knowledge Library, NIGO History.
- `src/components/compliance/DocumentUpload.tsx` (312) — importers: `ComplianceIntelligence.tsx:17`, `DocumentsTab.tsx:14`. **No other.**
- `src/components/compliance/DocumentsTab.tsx` (359) — importer: `ComplianceIntelligence.tsx:18`. **No other.**
- **`src/components/compliance/ComplianceControls.tsx` (249) — NOT part of this feature.** Despite its path, its only importers are the three `(compliance)` officer pages. **PROTECTED.** This is the directory-name trap Section 2 warns about.
- No feature-specific hook, context, or store exists; state is local `useState`/`useCallback` inside `ComplianceIntelligence.tsx`.
- `ListShell` from `@/components/archetypes` and all `@/components/ui/*` are **SHARED**.

### (d) lib/ modules — PROVEN, and two are load-bearing for a protected subsystem
- `src/lib/compliance/intelligence.ts` (288) — authority tiers, FTS retrieval over `compliance_chunks`, citation VERIFY GATE, `runJson` gateway helper.
- `src/lib/compliance/pipeline.ts` (162) — `extractDocument` (native→vision OCR) + `structureRightBridge`.
- `src/lib/compliance/extract.ts` (291) — pure byte→text helpers + RightBridge structured schemas.
- `src/lib/compliance/uploads.ts` (132) — DB/storage state machine. Importers: only `upload/route.ts:16`, `upload/[id]/route.ts:10`. **EXCLUSIVE.**

**PROTECTED, in the same directory, NOT removal targets:** `src/lib/compliance/firewall.ts` (securities firewall), `src/lib/compliance/guardrail.ts` (AI green-zone/red-line), `src/lib/compliance.ts` (FINRA disclaimer + AI action lists).

**CRITICAL CROSS-BOUNDARY DEPENDENCY (PROVEN):** the **AI Knowledge Library** depends on two of the four modules above:
- `src/lib/knowledge/uploads.ts:30` imports `extOf, fileFamily, joinPageText, ALLOWED_EXTENSIONS, MAX_UPLOAD_BYTES` from `@/lib/compliance/extract`
- `src/app/api/knowledge/upload/route.ts:6` imports `sha256Hex` from `@/lib/compliance/extract`
- `src/lib/knowledge/uploads.ts:29` imports `extractDocument` from `@/lib/compliance/pipeline`
- and transitively `src/lib/compliance/pipeline.ts:14` imports `runJson` from `@/lib/compliance/intelligence`

⇒ **`extract.ts`, `pipeline.ts` and `intelligence.ts` cannot be file-deleted.** See Entry 3 for the surgical boundary.

`src/lib/storage/private-documents.ts` is **SHARED** (importers: `api/knowledge/[id]:7`, `api/knowledge/upload:16`, `lib/compliance/uploads.ts:15`, `lib/knowledge/uploads.ts:31`).
`src/lib/ai/gateway` is **SHARED** (≈20 consumers incl. assistant, social, FNA, jobs, briefing).

### (e) Types, schemas, constants — PROVEN
- **`src/lib/validation/schemas.ts:1316–1463`** — one contiguous, self-contained block: header comment (1316), `AUTHORITY_TYPE_VALUES` (1320), `scopeArray` (1331), `ComplianceIngestSchema` (1338), `NigoAnalyzeSchema` (1356), `NigoOutcomeSchema` (1375), `ComplianceNoteSchema` (1383), `ComplianceChecklistSchema` (1396), `RightbridgeIngestSchema` (1408), `COMPLIANCE_UPLOAD_KINDS` (1425), `ComplianceUploadPatchSchema` (1439), `NigoIssuePatchSchema` (1447) → type at 1463. `AUTHORITY_TYPE_VALUES` and `scopeArray` are consumed **only inside this block** (1340/1344/1345). The next section (1465, suppression schemas) is **PROTECTED**. `KNOWLEDGE_CONTENT_MAX` (1224) is **SHARED** — used by `lib/knowledge/uploads.ts`.
- **`src/lib/types/database.ts` contains ZERO intelligence types** (verified by search). Feature types live in `intelligence.ts` (`AuthorityType`, `NigoValidity`) and `extract.ts` (`Structured*`).
- **Permissions:** no feature-exclusive permission string exists. Routes use `requireApiRole('fsa')` + a **file-local** `const WRITE_ROLES` (redeclared per route file). Officer routes use `requireApiRole('compliance')`. Nothing shared to unpick.

### (f) Database — PROVEN from migrations (no DB queried)
Created by exactly **two** migrations, `036_compliance_intelligence.sql` (274) and `037_compliance_document_pipeline.sql` (194). **No other migration in the 127-file set references any of these objects.**

**7 tables:** `compliance_documents`, `compliance_chunks`, `nigo_cases`, `nigo_issues`, `rightbridge_reports` (036); `compliance_uploads`, `compliance_upload_pages` (037).
**3 enums:** `authority_type`, `nigo_validity` (036:37,44); `compliance_upload_status` (037:33).
**~20 indexes**, **6 `updated_at` triggers**, **2 tsvector triggers**, optional pgvector `embedding` column + ANN index (036:113-116).

**Foreign keys — every one is INTERNAL to the set; there are ZERO outbound FKs to the core spine:**
`compliance_chunks→compliance_documents` (036:84) · `nigo_issues→nigo_cases` (036:173) · `rightbridge_reports→nigo_cases` (036:198) · `compliance_uploads→nigo_cases` (037:45) · `compliance_uploads→rightbridge_reports` (037:71) · `compliance_upload_pages→compliance_uploads` (037:93) · `rightbridge_reports→compliance_uploads` (037:124) · `nigo_cases→compliance_uploads` (037:137).

> **Doc-vs-code contradiction (code wins):** `docs/enterprise-audit.md:123` claims `nigo_cases` has an "FK to `cases`". **False.** `036:148` reads `work_item text, -- free-text work/reference id (NOT a FK)`. ADR-012's "no foreign key into the aggregate-root case spine" is the accurate statement.

**RLS:** all 7 tables `enable row level security` with `<table>_read` / `<table>_write` policies built from `is_super()/has_role()` helpers defined in migration 010 (036:240-274, 037:168-194). Read roles: compliance, supervisor, fsa, licensed_staff, admin, ops. **Migration 010's helpers are PROTECTED and shared.**

**Storage:** `COMPLIANCE_BUCKET` (`lib/compliance/uploads.ts:18`) is an **alias of the shared** `PRIVATE_DOCUMENTS_BUCKET = 'documents'` (`lib/storage/private-documents.ts:15`), created in migration 001 and shared with the knowledge library and other document features. **The bucket itself must not be dropped** — only objects under the feature's prefix are in scope.

### (g) Background work — PROVEN NEGATIVE
`vercel.json` read in full: **24 cron entries, NONE of which belong to this feature.** No queue, no webhook, no scheduled job references any intelligence module or table. The workforce orchestrator (`/api/cron/workforce-orchestrator`) and all lifecycle crons are untouched. **There is no intelligence-specific scheduled job to remove.**

### (h) Third-party surface — PROVEN NEGATIVE
**The feature never sends anything.** A search of every intelligence module, route and component for `comms/`, `dispatcher`, `sendThroughGate`, `twilio`, `resend`, `/send`, `email/` returns **zero hits**. It touches only the shared AI gateway (`PIPELINE_MODEL = 'claude-sonnet-5'`, `pipeline.ts:30`). ADR-012's "no autonomous outward dispatch" claim is **verified against code**.

### (i) Env vars — PROVEN NEGATIVE
**No env var is exclusive to this feature.** The feature reads `process.env` **nowhere**; credentials come from the shared gateway/Supabase clients. `scripts/load-seed-corpus.mjs:49-50` reads only shared `SUPABASE_*` vars. **Nothing to remove from `.env.local.example` or Vercel config.**

### (j) Navigation / permission gates / flags — PROVEN
**Exactly one** navigation reference exists repo-wide:
- `src/lib/workspaces/registry.ts:450` — `{ href: '/app/compliance/intelligence', label: 'Compliance Intelligence', icon: 'ScanSearch' }`, inside workspace `compliance-fsa`.
- `registry.ts:447` — the workspace `description` string ends "…, and Compliance Intelligence." (cosmetic copy).
- `src/app/(fsa)/app/compliance/page.tsx` does **not** link to it.
- No feature flag, no env toggle, no middleware matcher, no redirect/rewrite references the path (`next.config.js`, `src/middleware.ts` checked).

### (k) Tests / fixtures / seeds — PROVEN
Discovery is a **directory scan**: `scripts/run-tests.mjs:36-39` selects every `tests/*.{mjs,mts}` minus a hard-coded 15-entry `RLS` allowlist (`:15-31`). Deleting a test file needs no `package.json` edit, and **no intelligence test is in the RLS allowlist**.

- **There is no test file exclusive to this feature.** Only `tests/compliance-extract.test.mjs` mentions intelligence concepts at all, and it tests the **shared** `extract.ts` — it must be **trimmed, not deleted**.
- **False friends (all PROTECTED, retain):** `tests/compliance.test.mjs` → tests `src/lib/compliance.ts` (GDC tier selection); `tests/knowledge-library-documents.test.mjs` → knowledge library; `tests/ai-tool-authority.test.mjs`, `tests/comms-ai-authority.test.mjs` → guardrail/firewall.
- **`tests/workspace-registry.test.mjs` is coupled** — see Entry 3.

**Seed corpus (feature-exclusive):** `scripts/load-seed-corpus.mjs` (→ `compliance_documents`/`compliance_chunks`), `scripts/fetch-rules.ts` (→ same), `data/seed_corpus.json` (52 K), `data/rule_sources.json` (8 K), `data/regulatory_sources/` (**5.7 MB, 13 PDFs + SHA256SUMS.txt**), and the `package.json` scripts `load:corpus` (`:15`) and `fetch:rules` (`:16`).
`data/agency_directory_2026.csv` is unrelated — do not touch.

### (l) Docs / ADRs / skills — 34 markdown files reference the feature
Governing: **`docs/adr/ADR-012-compliance-intelligence-exception.md`** (the authorization of record), `docs/compliance/` (6 files: Blueprint, START_HERE, CORPUS_README, objective_standard, ai-reply-classification, config-defaults-to-verify), and `CLAUDE.md` §4 skills table.
**Feature-exclusive skills:** `.claude/skills/fsos-nigo-intelligence/`, `.claude/skills/rightbridge-pdf-analysis/`, `.claude/skills/finra-rule-ingestion/`.
Other references: `PRODUCT.md`, `README.md`-adjacent docs, `docs/{sitemap,build-order,enterprise-audit,legacy-port,PROMPTS}.md`, `docs/redesign/*` (4), `docs/recon/*` (2), `docs/specs/*` (4), `docs/adr/README.md`, `reports/2026-08-17-*`.

> **Second doc-vs-code contradiction:** the `fsos-nigo-intelligence` skill description names tables `knowledge_documents, knowledge_chunks`. **`knowledge_chunks` does not exist anywhere in the repo**, and `knowledge_documents` belongs to the *separate, protected* AI Knowledge Library (migration 033/102, surface `/app/knowledge`). The feature's real tables are `compliance_documents`/`compliance_chunks`. **Two different "knowledge libraries" exist and must not be conflated.**

### (m) package.json dependencies — PROVEN: NONE are exclusive
- `pdf2json` — also `src/lib/import/pdf.ts:59` (contact-import PDF path) and `scripts/fetch-rules.ts:27`. **Retain.**
- `@react-pdf/renderer` — FNA report only (`lib/fna/report-pdf.tsx`). Unrelated.
- `@anthropic-ai/sdk` — behind the shared gateway. **Retain.**
- `exceljs`, `jszip`, `fast-check`, `zod`, `decimal.js` — unrelated or repo-wide.

**No npm dependency can be removed by this excision.**

---

## Entry 3 — Section 4 (Classification of every artifact) — 2026-08-28T22:17:46Z

**HEAD SHA:** `ab8198fca3e81e722225e944b27d15369772470c`. Still READ-ONLY.
All rows below are **PROVEN** (read this run, with inbound searches actually executed) unless the row says otherwise.

### EXCLUSIVE — referenced only from within the feature

Inbound-reference search run for every row across `src/`, `tests/`, `scripts/`, `docs/`, `supabase/`, plus config; by path **and** by symbol name.

| # | Artifact | Every inbound reference found |
|---|---|---|
| 1 | `src/app/(fsa)/app/compliance/intelligence/page.tsx` | Only `registry.ts:450` (nav) + `tests/workspace-registry.test.mjs:107` |
| 2 | `src/components/compliance/ComplianceIntelligence.tsx` | Only `…/intelligence/page.tsx:2` |
| 3 | `src/components/compliance/DocumentUpload.tsx` | Only `ComplianceIntelligence.tsx:17`, `DocumentsTab.tsx:14` |
| 4 | `src/components/compliance/DocumentsTab.tsx` | Only `ComplianceIntelligence.tsx:18` |
| 5 | `src/app/api/compliance/analyze/route.ts` | Only `ComplianceIntelligence.tsx:253` |
| 6 | `src/app/api/compliance/note/route.ts` | Only `ComplianceIntelligence.tsx:418` |
| 7 | `src/app/api/compliance/checklist/route.ts` | Only `ComplianceIntelligence.tsx:711` |
| 8 | `src/app/api/compliance/rightbridge/route.ts` | Only `ComplianceIntelligence.tsx:553` |
| 9 | `src/app/api/compliance/ingest/route.ts` | Only `ComplianceIntelligence.tsx:827,848` |
| 10 | `src/app/api/compliance/history/route.ts` | Only `ComplianceIntelligence.tsx:1042` |
| 11 | `src/app/api/compliance/stats/route.ts` | Only `ComplianceIntelligence.tsx:1043` |
| 12 | `src/app/api/compliance/upload/route.ts` | Only `DocumentUpload.tsx:108`, `DocumentsTab.tsx:76` |
| 13 | `src/app/api/compliance/upload/[id]/route.ts` | Only `ComplianceIntelligence.tsx:933`, `DocumentsTab.tsx:209,232,253` |
| 14 | `src/app/api/compliance/issues/[id]/route.ts` | Only `ComplianceIntelligence.tsx:192` |
| 15 | `src/lib/compliance/uploads.ts` | Only `upload/route.ts:16`, `upload/[id]/route.ts:10` |
| 16 | `src/lib/compliance/intelligence.ts` | Rows 5–8 **plus `pipeline.ts:14` (`runJson`)** — becomes fully exclusive *after* the `pipeline.ts` surgery below. **Symbol-level proof:** every other export (`GROUNDING_SYSTEM`, `retrieveChunks`, `renderChunks`, `verifyCitations`, `highestAuthority`, `isAuthorityType`, `isValidity`, `INSUFFICIENT`, `RetrievedChunk`) resolves only to rows 5–8; `groundedCitationSet`, `buildRetrievalQuery`, `AUTHORITY_META`, `VALIDITY_VALUES` have **no consumer at all outside the file**. |
| 17 | `scripts/load-seed-corpus.mjs` | Only `package.json:15` (`load:corpus`) |
| 18 | `scripts/fetch-rules.ts` | Only `package.json:16` (`fetch:rules`) |
| 19 | `data/seed_corpus.json`, `data/rule_sources.json`, `data/regulatory_sources/` (13 PDFs + `SHA256SUMS.txt`, 5.7 MB) | Only rows 17–18 |
| 20 | `.claude/skills/fsos-nigo-intelligence/`, `.claude/skills/rightbridge-pdf-analysis/`, `.claude/skills/finra-rule-ingestion/` | Only `CLAUDE.md` §4 skills table |
| 21 | `docs/compliance/` (6 files) | Referenced by ADR-012 and code comments |
| 22 | `supabase/migrations/036_compliance_intelligence.sql`, `037_compliance_document_pipeline.sql` | **Historical migrations — see Entry 4; these are NOT deletion candidates.** |

**False-positive checks performed and cleared (name collisions, not dependencies):**
- `extractJson` at `src/lib/social/drafter.ts:61` is a **locally defined function**, not an import from `intelligence.ts`.
- `RetrievedChunk` at `src/lib/ai/responder.ts:12` is imported from **`@/lib/knowledge/library`** — a different type of the same name.
- `AUTHORITY_TYPES` at `ComplianceIntelligence.tsx:76` is a **local const**, not the `intelligence.ts` export.

### ENTANGLED — intelligence logic inside a shared/protected module; requires surgical extraction, NOT file deletion

**E1 — `src/lib/compliance/pipeline.ts` (162 lines).** Protected consumer: the **AI Knowledge Library** (`src/lib/knowledge/uploads.ts:29` imports `extractDocument`, used at `:158`).
- **Extract (intelligence-only):** `const STRUCTURE_SYSTEM` (lines **118–125**), `export async function structureRightBridge(...)` (lines **127–162**, the doc-comment through EOF), the import `import { runJson } from '@/lib/compliance/intelligence'` (line **14**), and the RightBridge type/schema names in the `@/lib/compliance/extract` import block (line **15–28**, specifically `StructuredRightBridgeSchema` at **:18** and `renderPagesWithMarkers` at **:26**).
- **Retain:** `PIPELINE_MODEL` (:30), `OCR_SYSTEM` (:32), `extractDocument` (:53–90), `extractViaVision` (:91–116), and its imports `densityConfidence` (:19), `extractPdfText` (:21), `extractPlainText` (:22), `imageMediaType` (:24), `pagesFromModelText` (:25).
- **Consequence (this is the key ordering fact):** `runJson` is referenced in this file **only at line 158**, inside `structureRightBridge`. Removing E1 therefore severs the *last* cross-boundary edge into `intelligence.ts`, after which row 16 becomes a plain whole-file deletion.

**E2 — `src/lib/compliance/extract.ts` (291 lines).** Protected consumers: `src/lib/knowledge/uploads.ts:30` (`extOf, fileFamily, joinPageText, ALLOWED_EXTENSIONS, MAX_UPLOAD_BYTES`) and `src/app/api/knowledge/upload/route.ts:6` (`sha256Hex`).
- **Extract (intelligence-only, verified symbol-by-symbol):** `PARSER_VERSION` (:23 — consumers `rightbridge/route.ts:9,137`, `upload/[id]/route.ts:8,138`, `uploads.ts:9,98`, all excised); `guessKind` (:234–252 — only `uploads.ts:9,84`); `StructuredQuestionSchema` (:253–261), `StructuredQuestion` (:261), `StructuredSectionSchema` (:263–268), `StructuredSection` (:268), `StructuredRightBridgeSchema` (:270–274), `StructuredRightBridge` (:274), `summarizeStructuredReport` (:277–291 — only `upload/[id]/route.ts:8,147,148`); and `renderPagesWithMarkers` (:217–223), whose **only** `src/` consumer is `pipeline.ts:136` inside `structureRightBridge` (removed by E1).
- **Retain:** `MAX_UPLOAD_BYTES`, `ALLOWED_EXTENSIONS`, `ExtractionMethod`, `fileFamily`, `extOf`, `imageMediaType`, `sha256Hex`, `ExtractedPage`, `ExtractionResult`, `densityConfidence`, `reconstructPageText`, `extractPdfText`, `extractPlainText`, `pagesFromModelText`, `joinPageText`, and the `import { extractPdfPages } from '@/lib/import/pdf'` (:20).
- **Note:** removing `StructuredRightBridgeSchema` removes the file's only `zod` usage — the `import { z } from 'zod'` (:19) then becomes dead and must go with it, or lint will flag it.

**E3 — `src/lib/validation/schemas.ts` (1496 lines).** A repo-wide shared module.
- **Extract:** the contiguous block **lines 1316–1463** (section comment → `export type NigoIssuePatch`). Its two helpers `AUTHORITY_TYPE_VALUES` (:1320) and `scopeArray` (:1331) are consumed **only inside the block** (:1340, :1344, :1345), so they leave with it.
- **Retain:** everything before 1316 and from 1465 (the **PROTECTED** suppression schemas). `KNOWLEDGE_CONTENT_MAX` (:1224) is shared with `lib/knowledge/uploads.ts` — **must not** be touched.

**E4 — `src/lib/workspaces/registry.ts`.** Protected module (drives all portal navigation).
- **Extract:** the single nav object at **line 450** — `{ href: '/app/compliance/intelligence', label: 'Compliance Intelligence', icon: 'ScanSearch' }`.
- **Also update:** the workspace `description` at **:447** which ends "…, and Compliance Intelligence." (cosmetic string).
- **Retain:** the whole `compliance-fsa` workspace, including `match: ['/app/compliance', …]` (:446) — it still serves Overview/Consent/DNC/Firewall/Licenses.

**E5 — `tests/workspace-registry.test.mjs`.** Protected test.
- **Hard coupling (WILL FAIL if mishandled):** `:87-89` Invariant 2 asserts `routeExists(item.href)` for every registry nav item. **Deleting `page.tsx` without also deleting `registry.ts:450` fails this test.** The two edits must land together.
- **Soft coupling (stale, will NOT fail):** `:107` lists `/app/compliance/intelligence` in `LEGACY_FSA_NAV`, checked by `coveredSpecifically` (:112-116), which tests **workspace `match` prefixes**, not nav items. Since `match` retains `/app/compliance`, the assertion still passes after removal. It becomes a stale reference to a nonexistent destination — remove for hygiene, but it is **not** a build blocker. *(Distinction verified by reading the helper, not assumed.)*

**E6 — `tests/compliance-extract.test.mjs` (158 lines).** Covers **both** surviving and removed symbols; must be **trimmed, not deleted**.
- **Remove the assertions for:** `guessKind` (:42, :128-130), `summarizeStructuredReport` (:43, :149), `StructuredRightBridgeSchema` (:44, :135, :153), `renderPagesWithMarkers` (:40, :122).
- **Keep the assertions for:** `imageMediaType` (:36, :77), `densityConfidence` (:37, :82-86), `reconstructPageText` (:38, :100), `pagesFromModelText` (:39, :108-112) — these cover the shared core the knowledge library relies on. Deleting the file outright would **silently drop regression coverage of a surviving protected path.**

**E7 — `package.json`.** Remove scripts `load:corpus` (:15) and `fetch:rules` (:16). **No dependency may be removed** — see Entry 2 (m).

**E8 — `CLAUDE.md`.** §4 skills table rows for `fsos-nigo-intelligence`, `finra-rule-ingestion`, `rightbridge-pdf-analysis`; §13 reference list. Documentation-only.

### SHARED — NOT removal targets, with the consumers that keep them alive

| Artifact | Consumers outside the feature |
|---|---|
| `src/lib/compliance/extract.ts` (core) | `lib/knowledge/uploads.ts:30`, `api/knowledge/upload/route.ts:6` |
| `src/lib/compliance/pipeline.ts` (core) | `lib/knowledge/uploads.ts:29` |
| `src/lib/storage/private-documents.ts` | `api/knowledge/[id]:7`, `api/knowledge/upload:16`, `lib/knowledge/uploads.ts:31`, `tests/knowledge-library-documents.test.mjs:51` |
| `src/lib/ai/gateway` | ~20 consumers: assistant, social drafter, FNA, `src/jobs`, briefing, next-action, meeting-prep |
| `src/lib/import/pdf.ts` + `pdf2json` | contact-import PDF path; `scripts/fetch-rules.ts:27` |
| `src/lib/validation/schemas.ts` | repo-wide |
| `src/lib/auth/api.ts`, `src/lib/audit/log.ts`, `src/lib/http`, `src/lib/supabase/client` | repo-wide |
| `@/components/archetypes` (`ListShell`), `@/components/ui/*` | repo-wide |
| `documents` storage bucket (migration 001) | knowledge library + other document features |
| Migration 010 `is_super()` / `has_role()` helpers | every RLS policy in the repo |

### PROTECTED — inside the Section 2 boundary; explicitly excluded

`src/lib/compliance/firewall.ts` · `src/lib/compliance/guardrail.ts` · `src/lib/compliance.ts` · `src/components/compliance/ComplianceControls.tsx` · all of `src/app/(compliance)/**` · `api/compliance/{attestations,attestations/[id],policies,policies/[id],legal-holds,legal-holds/[id],events/[id]}/route.ts` · `src/lib/services/eventDeletion` · the entire AI Knowledge Library (`src/lib/knowledge/**`, `api/knowledge/**`, `knowledge_documents`, `knowledge_citations`) · `src/lib/pipelines.ts` · all 24 crons in `vercel.json` · `tests/{compliance,guardrail,ai-tool-authority,comms-ai-authority,knowledge-library-documents}.test.mjs` · the entire comms/send path (never referenced by this feature).

### AMBIGUOUS — could not be resolved read-only

| # | Item | Evidence needed to resolve |
|---|---|---|
| A1 | **Production row counts** in the 7 tables. | A `select count(*)` per table against the production database. Read-only static analysis cannot know whether these hold 0 rows or 10,000. **NOT VERIFIED.** |
| A2 | **Live storage objects** under the feature's prefix in the shared `documents` bucket. | A Supabase Storage listing. The bucket is shared, so object-level enumeration — not bucket inspection — is required. **NOT VERIFIED.** |
| A3 | **Whether the pgvector `embedding` column was actually created** (`036:110-118` is conditional on the `vector` extension being present). | `\d compliance_chunks` on the live DB, or `select * from pg_extension where extname='vector'`. **NOT VERIFIED.** |
| A4 | **Whether any `audit_log` rows reference the feature's entity types** (`rightbridge_report`, `nigo_case`, …) written by `writeAudit` in the excised routes. | `select distinct entity from audit_log where entity in (...)`. Audit rows are **supervision artifacts** and are written to a **protected, append-only** table (migration 077 `audit_log_lockdown`) — they survive removal regardless, but the owner should know they exist. **NOT VERIFIED.** |
| A5 | Whether any **external bookmark, saved link, or operator habit** depends on the URL. | Web-analytics or access logs. Removal returns 404 rather than a redirect unless one is added. **HYPOTHESIS** that this matters; unconfirmed. |

**No dynamic imports, string-keyed registries, runtime feature flags, or DB-driven config were found for this feature** — verified: `grep "import("` across `src/lib/compliance`, `src/components/compliance`, `src/app/api/compliance` returns **zero** hits, and every table reference is a literal `.from('…')` string inside the excision set.

---

## Entry 4 — Section 5 (Data layer — ENUMERATED, NOT DECIDED) — 2026-08-28T22:18:55Z

**HEAD SHA:** `ab8198fca3e81e722225e944b27d15369772470c`.
**No SQL was executed against any database. No destructive migration was authored. Nothing is proposed for dropping.**

### The 7 owned tables

| # | Table | Created | Holds | Any protected/core reader or writer? | Supervision / consent / touch-log / books-and-records material? |
|---|---|---|---|---|---|
| 1 | `compliance_documents` | 036:53 | Governing-authority docs: title, `authority_type`, `source_org`, `section_ref`, `effective_date`, product/state scope, carrier, `verbatim`, `is_assumption`, `file_ref` | **No.** Writers/readers: `api/compliance/ingest:50,87` only | **Likely YES.** `docs/compliance/CORPUS_README.md:21` and `START_HERE.md:109` direct the FSA to upload **the FFS compliance manual, WSPs, and FCB bulletins**. If done, this table holds firm supervisory procedure text. **NOT VERIFIED** (needs live inspection). |
| 2 | `compliance_chunks` | 036:82 | Chunked passages + `chunk_key`, `section_ref`, `governs_patterns`, FTS `search_tsv`, optional `embedding` | **No.** `lib/compliance/intelligence.ts:134`, `api/compliance/ingest:57,122`, seed scripts | Same as #1 — it is the chunked body of those documents. |
| 3 | `nigo_cases` | 036:146 | `work_item`, `client_ref` (non-substantive), product, carrier, reviewer, state, **`raw_nigo_text`**, `received_at`, `round_number`, `outcome`, `lessons_learned` | **No.** `analyze:104,110,119`, `history:28,108`, `stats:38`, `rightbridge:80`, `upload:136` | **Probable YES.** `raw_nigo_text` is verbatim carrier/BD not-in-good-order correspondence about a real transaction — squarely the kind of record FINRA 4511 / SEC 17a-4 reach. |
| 4 | `nigo_issues` | 036:171 | Per-issue `issue_text`, `citations`, `authority_type`, `validity`, `explanation`, `what_to_fix`, `draft_artifact`, `resolution`, **`response_text`** | **No.** `analyze:215`, `history:55`, `stats:39`, `issues/[id]:38,46`, `rightbridge:82` | **Probable YES.** `response_text` / `draft_artifact` are the drafted responses to a regulator- or carrier-raised deficiency. |
| 5 | `rightbridge_reports` | 036:196 | `report_type`, `parsed_fields`, learned structure, `upload_id`, `parser_version` | **No.** `rightbridge:81,125`, `upload/[id]:128` | **Possible.** RightBridge is a **suitability/best-interest** tool. ADR-012 asserts the module stores no suitability determination, but parsed report fields may still constitute Reg BI evidence. **NOT VERIFIED.** |
| 6 | `compliance_uploads` | 037:41 | Upload metadata: filename, `sha256`, `kind`, `status`, `storage_path`, `case_id`, `report_id`, `error` | **No.** `upload/route.ts:43,118,151`, `upload/[id]:35,79,90,110,123,146,171,179`, `lib/compliance/uploads.ts:64,89,118`, `rightbridge:149` | Metadata pointing at stored originals — the **index** to #7 and to bucket objects. |
| 7 | `compliance_upload_pages` | 037:91 | Per-page extracted text + FTS vector | **No.** `lib/compliance/uploads.ts:70,72`, `analyze:72`, `rightbridge:55`, `upload/[id]:45,112` | Full text of every uploaded document — inherits the classification of whatever was uploaded. |

**Confirmed structural facts:** 3 enums (`authority_type`, `nigo_validity`, `compliance_upload_status`); ~20 indexes; 6 `updated_at` triggers + 2 tsvector triggers; RLS enabled on all 7 with `_read`/`_write` policies. **All 8 foreign keys are internal to this set — zero outbound FKs into the core spine, and no other migration references any of these objects.** Dropping them could not orphan a core table.

### Row-count queries I WOULD run (NOT run — production is out of scope for Phase A)

```sql
-- Run read-only, against a non-production replica if one exists.
select 'compliance_documents'   as t, count(*) from compliance_documents
union all select 'compliance_chunks',       count(*) from compliance_chunks
union all select 'nigo_cases',              count(*) from nigo_cases
union all select 'nigo_issues',             count(*) from nigo_issues
union all select 'rightbridge_reports',     count(*) from rightbridge_reports
union all select 'compliance_uploads',      count(*) from compliance_uploads
union all select 'compliance_upload_pages', count(*) from compliance_upload_pages;

-- Is any of it real operating data rather than seed corpus?
select source, count(*) from compliance_documents group by source;   -- 'seed' vs upload/manual/import
select outcome, count(*), min(received_at), max(received_at) from nigo_cases group by outcome;

-- Storage objects still referenced in the SHARED 'documents' bucket:
select count(*), sum(octet_length(coalesce(storage_path,''))) from compliance_uploads where storage_path is not null;

-- Supervision trail that will OUTLIVE the tables (audit_log is append-only, migration 077):
select entity, count(*) from audit_log
 where entity in ('compliance_document','compliance_note','compliance_upload',
                  'nigo_case','nigo_issue','rightbridge_report')
 group by entity;

-- Was the optional pgvector column actually created? (036:110-118 is conditional)
select 1 from pg_extension where extname = 'vector';
```

### Facts the owner needs before deciding

1. **The audit trail survives regardless, and is already immutable.** The excised routes write `writeAudit` rows under six entity types — `compliance_document`, `compliance_note`, `compliance_upload`, `nigo_case`, `nigo_issue`, `rightbridge_report`. `audit_log` is **append-only by construction**: migration `077_audit_log_lockdown.sql` revokes INSERT from `authenticated`/`anon`, revokes TRUNCATE from `public`, and adds a statement-level trigger raising `'audit_log is append-only (TRUNCATE not permitted)'` (:28-36). **These rows cannot be removed by any option below**, and after a table drop their `entity_id` values become dangling references to rows that no longer exist.
2. **The storage bucket is shared and must not be dropped.** `COMPLIANCE_BUCKET` is an alias of `PRIVATE_DOCUMENTS_BUCKET = 'documents'` (migration 001), shared with the AI Knowledge Library and other document features. Only **objects** under the feature's prefix are ever in scope.
3. **The repository already has a written precedent for exactly this situation.** `docs/legacy-port.md:127`: *"**Never drop a legacy table** in this phase. Retire *UI and routes only*. Data stays for retention/audit (≥7yr). Table drops are a separate, later decision."* `docs/specs/missing-requirement-analysis.md:69` records "≥7yr retention + legal-hold gate on delete".
4. **A legal-hold mechanism exists and is protected.** `/compliance/legal-holds` and `api/compliance/legal-holds` are live and out of scope for removal. Whether a hold currently covers any of this data is **NOT VERIFIED**.
5. **Removing the UI does not by itself remove the data.** Because no cron, job, or core module touches these tables, dropping only the code leaves the tables inert but intact and still RLS-protected.

### Options, with consequences — presented, NOT chosen

| Option | What happens | Consequences |
|---|---|---|
| **R — Retain in place** (code removed, schema and rows untouched) | 7 tables, 3 enums, indexes, triggers, RLS all remain; migrations 036/037 stay in history unchanged; rows keep their existing RLS protection; `audit_log` entity refs stay resolvable | Zero data-loss risk. Matches the repo's own `legacy-port.md:127` precedent and the ≥7yr retention posture. Nothing is reachable through the UI. Cost: dormant schema and a small ongoing storage footprint; a future reader may wonder why the tables exist (mitigate with a `comment on table`). **Reversible.** |
| **A — Archive, then drop** | Export all 7 tables (and the referenced bucket objects) to a retained archive under the firm's retention control, verify the export, then drop tables/enums in a new forward migration | Preserves the records outside the app while leaving a clean schema. Cost: the archive itself becomes a books-and-records artifact needing a defined custodian, location, format, and retention clock; export must be verified before any drop; `audit_log` refs still dangle. **Irreversible once dropped.** Requires the owner to name the archive destination and custodian. |
| **D — Drop outright** | New forward migration drops 7 tables (cascade), 3 enums, indexes, triggers, policies; bucket objects deleted by prefix | Smallest surface. **Permanent, irreversible loss** of every NIGO case, drafted response, uploaded document text, and — if the FFS manual/WSPs/FCB bulletins were uploaded per `CORPUS_README.md:21` — firm supervisory material. Would contradict `legacy-port.md:127` and the ≥7yr posture, and would leave `audit_log` referencing rows that no longer exist. **Not advisable without documented owner sign-off and confirmation that no legal hold applies.** |

**Retention of supervision-adjacent records is an owner decision under the FFS WSP, not a code decision. Phase A stops here.**

---
