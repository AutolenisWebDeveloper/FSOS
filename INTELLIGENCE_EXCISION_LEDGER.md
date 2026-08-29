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

# ═══════════════════════════════ PHASE B ═══════════════════════════════

## Entry 5 — Phase B execution (owner decisions D1–D6 applied) — 2026-08-28T23:59:23Z

**Base:** `6f25013` (Phase A ledger commit). **`main` confirmed at `ab8198f`; branch exactly 1 commit ahead, ledger only.** Clean tree at start.

### Owner decisions as executed
| ID | Decision | Executed |
|---|---|---|
| D1 | Data: **retain in place** | **Zero migrations created; zero migrations modified.** `git diff --name-only -- supabase/` is empty. No table, column, enum, index, FK, RLS policy or grant dropped. |
| D2 | Legal hold | Moot under D1. |
| D3 | New superseding ADR | **`docs/adr/ADR-040-compliance-intelligence-excision.md`** (163 lines). ADR-012 marked Superseded and retained; `docs/adr/README.md` index updated. |
| D4 | Storage: retain | **Zero storage operations performed.** No bucket, object, or policy touched. |
| D5 | Route: natural 404 | Route file deleted; **no redirect, rewrite, or placeholder added** (`next.config.js` and `src/middleware.ts` contain no `intelligence` reference). |
| D6 | Remove 3 skills + `docs/compliance/` | Skills removed. **`docs/compliance/` partially retained — see the G4 exceptions below.** |

### G4 RE-VERIFY — two exceptions found and RETAINED
Every file in `docs/compliance/` was read before deletion, as required.

| File | Verdict | Evidence |
|---|---|---|
| `ai-reply-classification.md` | **RETAINED** | Documents the SMS/email **auto-send rule**: consent, quiet hours, DNC, opt-out, TRAIGA disclosure (`:98-99`). **Zero** mentions of NIGO/RightBridge/`compliance_*`. Cited by **live protected code** at `src/lib/comms/reply-classification.ts:29` and by `docs/adr/ADR-019:72,149`. Deleting it would orphan a live code comment and an accepted ADR. |
| `config-defaults-to-verify.md` | **RETAINED** | Documents `comm_hours_policy` (**quiet hours**, migration 035) and `comm_frequency_policy` (**frequency caps**), for the two-way conversation feature. **Zero** intelligence mentions. Cross-referenced by the file above and by ADR-017/ADR-019. |
| `CORPUS_README.md`, `FSOS_Compliance_Intelligence_Blueprint.md`, `START_HERE.md`, `objective_standard.md` | Deleted | Intelligence-only: seed corpus, module blueprint, build index, note-hardening standard. |

The 3 skills were also re-read: **zero** protected-topic hits each (send gate / consent / DNC / quiet hours / A2P / CAN-SPAM / template approval / supervision), high intelligence-topic density. All three cleared for deletion.

**Consequence: `docs/compliance/` still exists and must not be removed as a directory.**

### G2 — no directory-level deletes in the mixed directories
Named files only. Proof by listing after the change:
- `src/app/api/compliance/` → **only the 7 protected routes remain**: `attestations/route.ts`, `attestations/[id]/route.ts`, `policies/route.ts`, `policies/[id]/route.ts`, `legal-holds/route.ts`, `legal-holds/[id]/route.ts`, `events/[id]/route.ts`. No empty directory left behind (`find -type d -empty` → none).
- `src/lib/compliance/` → `extract.ts`, `firewall.ts`, `guardrail.ts`, `pipeline.ts`. **`firewall.ts` and `guardrail.ts` untouched.**
- `src/components/compliance/` → `ComplianceControls.tsx` only (**protected**; consumed by the three `(compliance)` officer pages).

### G3 — knowledge-library collision held at every edit site
`knowledge_documents` / `knowledge_citations` / `/app/knowledge` / `src/lib/knowledge/**` / `/api/knowledge/**` were **not modified**. Only `compliance_documents` / `compliance_chunks` belonged to the excised feature, and both are retained under D1. The surviving halves of `extract.ts` and `pipeline.ts` exist **specifically** to serve the knowledge library.

### Execution order actually followed
`pipeline.ts` surgery → (nav + page, together) → components → 10 API routes → `uploads.ts` → `intelligence.ts` (plain delete, as predicted) → `extract.ts` surgery → `schemas.ts` → test trims → corpus + `package.json` → skills + docs → ADR-040 → doc references.

The Phase A prediction held: removing `structureRightBridge` severed the last cross-boundary edge, so **`intelligence.ts` was deleted whole with no surgery**.

---

## Entry 6 — extract.ts per-symbol proof, gates, and Phase A correction — 2026-08-29T00:00:24Z

### The `extract.ts` per-symbol proof table

Every symbol was scanned **after** the intelligence deletions, repo-wide across `src/`, `tests/`, `scripts/`, `supabase/`. Removals were applied **one at a time with `tsc --noEmit` between each**, never as a sweep.

| Symbol | Remaining refs after deletions | Verdict | Typecheck after removal |
|---|---|---|---|
| `renderPagesWithMarkers` | none in `src/`; only the test being trimmed | **REMOVED** | ✓ PASS |
| `guessKind` | none in `src/`; only the test being trimmed | **REMOVED** | ✓ PASS |
| `summarizeStructuredReport` | none in `src/`; only the test being trimmed | **REMOVED** | ✓ PASS |
| `StructuredRightBridgeSchema` / `StructuredRightBridge` | none in `src/`; only the test being trimmed | **REMOVED** | ✓ PASS |
| `StructuredSectionSchema` / `StructuredSection` | **zero** anywhere | **REMOVED** | ✓ PASS |
| `StructuredQuestionSchema` / `StructuredQuestion` | **zero** anywhere | **REMOVED** | ✓ PASS |
| `import { z } from 'zod'` | zero `z.` uses remained (asserted programmatically before removal) | **REMOVED** | ✓ PASS |
| **`PARSER_VERSION`** | zero code refs — **but persisted** | **RETAINED — exception** | n/a |

**PROOF — `PARSER_VERSION` is persisted, so it was RETAINED per the brief's rule.**
- The column `parser_version` exists on `compliance_uploads` (`037:73`) and `rightbridge_reports` (`037:129`) — **both retained under D1**, so rows carrying the literal `'fsos-doc-extract-1'` persist.
- Zero writers/readers remain in `src/`, `scripts/`, `tests/` after the deletions.
- The **knowledge path never references it at all** (zero hits in `src/lib/knowledge/` and `src/app/api/knowledge/`).
- The knowledge dedupe key is the **content hash, not the parser version**: `findDuplicateUpload(db, sha256)` (`knowledge/uploads.ts:199`), `.eq('sha256', sha256)` (`:204`), `sha256Hex(buffer)` (`api/knowledge/upload/route.ts:103`). No cache key or dedupe hash includes `PARSER_VERSION`.

It is therefore **knowingly-unused code retained on purpose**: it is the only in-repo record of what the persisted `parser_version` values mean, and removing it would make retained data uninterpretable. It carries an explanatory comment pointing at ADR-040, and ADR-040 documents it. **This is the only retention exception in the code.**

**PROOF — `renderPagesWithMarkers` is unreachable from the knowledge path.**
The knowledge path imports exactly `extractDocument` (`knowledge/uploads.ts:29`), five named helpers (`:30` — `extOf`, `fileFamily`, `joinPageText`, `ALLOWED_EXTENSIONS`, `MAX_UPLOAD_BYTES`) and `sha256Hex` (`api/knowledge/upload/route.ts:6`). `extractDocument`'s complete call set is `extOf`, `fileFamily`, `extractPlainText`, `extractPdfText`, `extractViaVision`, `pagesFromModelText`, `densityConfidence`, `imageMediaType`, `runGateway` — **`renderPagesWithMarkers` is not among them**. It had **zero internal callers** in `extract.ts` and zero `src/` callers repo-wide. Its only `src/` consumer had been `pipeline.ts:136`, inside `structureRightBridge`, removed in step 1.

`extract.ts`: 291 → 234 lines. `pipeline.ts`: 162 → 115 lines. **Every added line in both files is a comment — zero logic was added** (verified against the diff).

### Gate results

| Gate | Baseline (Phase A) | Post-excision | Result |
|---|---|---|---|
| `npm run type-check` | 0 | **0** | PASS |
| `npm run lint` | 0 | **0** — "No ESLint warnings or errors" | PASS |
| `npm test` | 0 · **192** files | **0 · 192 files** | PASS |
| `npm run test:rls` | 0 · **15** files | **0 · 15 files** | PASS |
| `npm run build` | 0 | **0** | PASS |

**Unit-count reconciliation — expected delta 0, actual delta 0.** No test file was added or deleted; two were **modified** (trimmed): `tests/compliance-extract.test.mjs` (six RightBridge/guessKind assertions removed; 20 assertions still pass) and `tests/workspace-registry.test.mjs` (one stale `LEGACY_FSA_NAV` entry removed). `git diff --diff-filter=AD -- tests/` is empty. Runner discovery reports **192 unit / 15 rls**, matching baseline exactly.

**`test:rls` held at 15/15** — as required under D1, since no policy changed.

**Note on a stale artifact (not a repository defect):** the first typecheck after the deletions failed with four `TS2307` errors from `.next/types/validator.ts`, a **build artifact generated by the Phase A baseline build** that still referenced the deleted routes. `rm -rf .next` cleared it and typecheck passed. All gate results above were produced from a clean `.next`.

### Verification of the removal itself
- **Route 404:** `src/app/(fsa)/app/compliance/intelligence/page.tsx` no longer exists; the production build manifest contains **zero** `compliance/intelligence` entries and exactly the 7 protected `api/compliance/*` routes. No redirect or rewrite was added (D5 honored).
- **Nav:** `grep -rn "compliance/intelligence" src/` → **zero hits**. The `compliance-fsa` workspace now lists Overview, Consent, DNC, Securities Firewall, Licenses, Settings, Help.
- **Residual sweep:** zero code references remain to any removed route, file, or symbol. The only surviving mentions are **deliberate historical annotations** in dated deliverables plus ADR-012 (retained as authorization history) and ADR-040.

### End-to-end upload through `/api/knowledge/upload` — **UNVERIFIED**

**It could not be run.** No `.env.local` exists and every required credential is unset (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`). A genuine route-level test needs a live Supabase database, live Storage, and the AI gateway. **No mock was substituted and no such test is claimed.**

What *was* proven, by executing real code offline (no mocks, no stubs):
- `src/lib/knowledge/uploads.ts` **bundles cleanly** through the surgically-edited `extract.ts` and `pipeline.ts` — the module graph resolves, which was the actual risk of the surgery.
- `sha256Hex(Buffer)` **executes** and returns a real digest.
- `extractDocument(bytes, 'proof-note.txt', 'text/plain')` **executes** and returns `{method:"text", pages:1, chars:66, low_confidence:false}` with correct page text. (The text family never reaches the gateway, so this is a real end-to-end extraction for that path.)
- All 10 `knowledge/uploads.ts` exports remain present.
- `tests/knowledge-library-documents.test.mjs` **passes** in the suite.

**Still unproven and requiring live infrastructure:** the HTTP route itself, storage write + signed-URL round trip, DB insert/dedupe against `knowledge_documents`, and the **model-vision OCR fallback** (scanned-PDF path), which is the one branch of `extractDocument` that calls the gateway.

### CORRECTION to Phase A (Entry 2 §f and Entry 3)

Phase A reported that `docs/enterprise-audit.md:123` **falsely asserts** an FK from `nigo_cases` to `cases`, and the Phase B brief accordingly directed that the line be corrected. **That Phase A finding was wrong, and no correction was made.**

The full sentence spans lines 122–123 and reads: *"`nigo_cases` keyed by free-text `work_item`/`client_ref` (**NOT a** FK to `cases`, `036:148-149`)"*. The Phase A grep matched the line-wrapped fragment `FK to \`cases\`` on line 123 without the `(NOT a` that ends line 122. **The document was already correct**; "correcting" it would have introduced an error. The underlying schema fact is unchanged and still verified: `036:148` reads `work_item text, -- free-text work/reference id (NOT a FK)`, and there is no FK into the case spine.

The second Phase A doc-vs-code finding **stands**: the removed `fsos-nigo-intelligence` skill named a `knowledge_chunks` table that has never existed in this repository.

### Self-review of the actual diff
Reviewed against the diff, not the plan. Confirmed: **zero migrations touched** (`git diff -- supabase/` empty); **zero storage operations**; no file removed outside the accepted manifest; protected modules altered only in the named surgical ways (`schemas.ts` = **149 deletions, 0 insertions**; `registry.ts` = exactly the two named changes; `extract.ts`/`pipeline.ts` added comments only); each `extract.ts` symbol removal individually proven and individually typechecked. **No material findings.**

---

# ═══════════════════════════════ PHASE C ═══════════════════════════════

## Entry 7 — Verify + rebase (no merge) — 2026-08-29T00:31:31Z

**Precondition confirmed.** Branch HEAD `d94e420`, tree clean, local == `origin/…` == `d94e420`.
**`origin/main` is still `ab8198f`** — unchanged since the Phase A baseline; nothing has landed in the interim.

### STEP 1 — PDF branch of `extractDocument`: **VERIFIED**

Real PDFs recovered from history (`git show main:data/regulatory_sources/…`) and run through the
post-excision `extractDocument`. No mocks, no credentials, no network.

| PDF | bytes | method | pages | chars | ordering | boundaries |
|---|---|---|---|---|---|---|
| `07_FINRA_2024_Oversight_Report.pdf` | 1,340,208 | **`native_pdf`** | **90** | 269,657 | strictly 1..90, no gaps/repeats | Σ per-page == `char_count` exactly |
| `08_SEC_Regulation_Best_Interest_34-86031.pdf` | — | **`native_pdf`** | **770** | 1,399,226 | strictly 1..770 | Σ per-page == `char_count` exactly |

`page_count === pages.length` in both. Zero empty pages, zero low-confidence pages, confidence 0.99,
90/90 and 770/770 page texts **distinct**. Page boundaries independently corroborated by content: page 45's
text begins `"FINRA Annual Regulatory Oversight Report | January 2024**45**…"` — the document's own printed
page number matches the array index, and the last page is the copyright page. Extraction of the 90-page
document took ~1.05 s.

**Regression check vs pre-excision `main`.** The `main` versions of `pipeline.ts` (162 lines) and
`extract.ts` (291 lines) were reconstructed from git, bundled, and run against the same four PDFs.
**Results are identical on every file** — `native_pdf`/90, `native_pdf`/770, `none`/0, `none`/0.
**The excision changed PDF behavior not at all.** (The temporary comparison files were staged inside the
repo to resolve the `@/` alias and were deleted immediately; the working tree was verified clean after.)

Two 2–3 KB stub PDFs (`01_FINRA_Rule_2330.pdf`, `02_FINRA_Rule_2111.pdf`) return `method: 'none'` — **on
`main` as well as on HEAD**. This is pre-existing and correct-by-design: a PDF whose native text layer
yields nothing is exactly the scanned/low-text case that routes to vision OCR, which is unavailable here
without a gateway key. Not a regression, not in scope, not repaired.

*A first attempt reported `method: 'none'` on the 1.3 MB PDF. That was a **harness** fault, not a code
fault: the bundle was written to `/tmp` with `--external:pdf2json`, where Node cannot resolve `pdf2json`.
Re-bundling inside the repo's module-resolution path produced the results above. Recorded because the
first number was wrong and the correction matters.*

### STEP 1b — vision-OCR fallback: reachable, unchanged, **UNVERIFIED**

- **Structurally unchanged:** `git diff main...HEAD -- src/lib/compliance/pipeline.ts` contains **zero**
  lines touching `extractViaVision`, `OCR_SYSTEM`, `runGateway`, `GatewayAttachment`, `attachments`,
  `pagesFromModelText`, `densityConfidence`, `maxTokens`, or `model:`.
- **Reachable from two call sites:** `pipeline.ts:73` (PDF whose native extraction is `low_confidence`)
  and `pipeline.ts:84` (`family === 'image'`). Both survive.
- Its dependencies `pagesFromModelText`, `densityConfidence`, `PIPELINE_MODEL` and `runGateway` were all
  retained by the excision.

**It remains UNVERIFIED. It cannot be executed without live AI-gateway credentials, which this environment
does not have. No mock was substituted and no claim of proof is made.**

### STEP 2 — Rebase onto `origin/main`: **no-op, zero conflicts**

`merge-base(HEAD, origin/main)` was already `ab8198f` == `origin/main`, so `git rebase origin/main`
reported *"Current branch … is up to date"* and exited 0. HEAD is unchanged at **`d94e420`**; both commits
remain (`6f25013` Phase A ledger, `d94e420` Phase B excision). **No conflicts arose, so no protected module
required a resolution, and no force-push was needed or performed.** Nothing's meaning changed under rebase.

### STEP 3 — Post-rebase gates (run after `rm -rf .next`)

| Gate | Expected | Actual | |
|---|---|---|---|
| `npm run type-check` | 0 | **0** | PASS |
| `npm run lint` | 0 | **0** — "No ESLint warnings or errors" | PASS |
| `npm test` | 192 files | **192 files** | PASS |
| `npm run test:rls` | 15 files | **15 files** | PASS |
| `npm run build` | 0 | **0** | PASS |

**5/5 green. Count reconciliation: expected delta 0, actual delta 0 — nothing to explain.** No TS2307s
appeared; clearing `.next` first was sufficient, as in Phase B.

### Constraints re-confirmed against `git diff origin/main...HEAD`
- **Migrations: 0 files differ** under `supabase/`.
- **Storage: zero operations** performed in this phase.
- **Surviving `src/` files altered: exactly four** — `compliance/pipeline.ts`, `compliance/extract.ts`,
  `validation/schemas.ts`, `workspaces/registry.ts`. Every other `src/` path in the diff is a deletion from
  the accepted manifest.
- Final diffstat vs `origin/main`: **62 files changed, 711 insertions(+), 6,806 deletions(-)**.
  (Per-commit: `6f25013` = 369 insertions; `d94e420` = 343 insertions / 6,807 deletions. The combined range
  is one lower on each side because a single line added in Phase A was rewritten in Phase B — see the defect
  below, now repaired.)

### DEFECT FOUND AND REPAIRED — Phase B corrupted one line of the Phase A ledger

**What happened.** Phase B appended Entry 6 using a placeholder token `TS_B`, substituted afterwards via
`s.replace('TS_B', <timestamp>, 1)`. The string `TS_B` also occurs **inside the identifier
`PRIVATE_DOCUMENTS_BUCKET`** (`PRIVATE_DOCUMEN` + `TS_B` + `UCKET`). Because `replace(..., 1)` takes the
*first* occurrence in the file, it hit **Entry 4, line 153** — inside the Phase A record — instead of the
Entry 6 heading. That line was left reading `PRIVATE_DOCUMEN2026-08-29T00:00:24ZUCKET`, and the Entry 6
heading kept the literal placeholder `TS_B`.

**Impact.** Cosmetic but real, and a violation of the append-only rule: prior ledger content was altered.
It was committed in `d94e420`. Exactly **one** line was affected — verified by scanning the whole file for
mid-word timestamps (one hit) and by a byte-level comparison of the first 369 lines against `6f25013`.
No code, test, migration, or gate result was affected; the corrupted text is prose inside a documentation
file.

**Repair.** Line 153 was restored **byte-exactly** from `git show 6f25013:INTELLIGENCE_EXCISION_LEDGER.md`,
and the Entry 6 heading received its correct timestamp via an anchored match on the heading line rather
than a bare substring. Re-verified: `cmp` now reports the Phase A 369 lines **byte-identical** as a prefix
of the current file — **append-only is restored**. Repairing corrupted prior content is a restoration of the
record, not a rewrite of it; the incident is disclosed here rather than silently fixed.

**Lesson for any future phase:** never substitute a placeholder token that can occur as a substring of real
content. Anchor the match (line prefix/suffix) or use a token that cannot collide.

### Not done, by instruction
No merge to `main`. No PR opened in this phase (PR #306, opened at the end of Phase B, still points at this
branch). No deploy.

---
