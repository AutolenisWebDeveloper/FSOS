# Slice 7 — Reporting + document output

> Governed by ADR-015 + ADR-016. Builds on the plan flow. Adds the PDF generator.

## What shipped
Client-facing and internal report output from an **APPROVED** version — reproducible
from the version, every figure traced to its formula + version + assumptions.

### Report model (pure)
- **`src/lib/fna/report.ts`** — `extractReportRows` (flatten an envelope's output to
  labeled money/percent rows), `buildReportSections` (per-formula sections with
  version, confidence, assumptions used, missing inputs), and the verbatim
  `REPORT_DISCLOSURE` (FINRA Reg BI). Shared by the HTML report, the PDF, and the
  Excel package so all three show identical figures.
- Tests: `tests/fna-report.test.mjs` (4).

### Approve + exports
- **`POST /api/fna/plans/[id]/approve`** — approves the current version (CALCULATED
  or UNDER_REVIEW → APPROVED; a solo FSA's review + approval collapse, §0.B). Only
  an APPROVED version is client-presentable (§4).
- **`GET …/report/pdf`** — server-rendered client PDF via **`@react-pdf/renderer`**
  (new dependency, pinned; added to `serverExternalPackages`). 403 unless APPROVED.
- **`GET …/report/xlsx`** — internal/compliance Excel package via **`exceljs`**
  (reused). 403 unless APPROVED.

### UI
- `/app/fna/plans/[id]/report` — the report/presentation view: DRAFT banner + Approve
  when unapproved; PDF + Excel downloads when approved. Every figure labeled and
  traceable; FINRA disclosure footer. Linked from the workspace rail.
- `/app/fna/reports` — reports index: approved (ready to present) + calculated
  (ready to review).

## Dependency
`@react-pdf/renderer@4.x` (MIT) — the required PDF generator. Verified: it compiles
in the Next build and renders to a Buffer server-side (`runtime = 'nodejs'`).

## Verification
type-check ✓ · lint ✓ · `npm test` ✓ (+report 4) · RLS proof ✓ (18/18) ·
build ✓ (report page + pdf + xlsx routes + reports index compiled).
