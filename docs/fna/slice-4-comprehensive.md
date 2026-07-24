# Slice 4 — Comprehensive FNA (prefill, protection/estate, audit, data quality)

> Governed by ADR-015 + ADR-016. Builds on Slice 3 (the plan flow). One draft PR.

## What shipped
Completes the Comprehensive path around the existing plan flow: prefill from FSOS
data, the protection and estate discovery modules, the plan audit trail, and the
documents / data-quality view. The Comprehensive plan type (fields + analyses) was
already registered in Slice 3; this slice makes intake faster and results deeper.

### Prefill (build instruction §5)
- **`src/lib/fna/prefill.ts`** — PURE mapper from a household context to suggested
  inputs. Derives `existing_life_coverage` (Σ non-securities policy face amounts —
  firewall-safe) and `current_age` (oldest member). Every suggestion is labeled
  `imported`, a starting value the FSA confirms.
- **`POST /api/fna/plans/[id]/prefill`** — loads `loadFnaContext`, maps, saves
  inputs, returns the values. The intake form's **"Prefill from household"** button
  merges them into EMPTY fields only (never clobbers a user entry).
- Tests: `tests/fna-prefill.test.mjs` (4) — sum, firewall exclusion, omit-empty, label.

### Pages
- `/app/fna/protection` — life (income-replacement + capital-needs) and disability
  gaps from the latest calculated version per plan.
- `/app/fna/estate` — beneficiary/estate discovery over household composition.
- `/app/fna/documents` — data-quality exceptions (missing/stale/conflicting/
  unverified) + FNA documents saved to Document OS.
- `/app/fna/plans/[id]/audit` — the plan's append-only audit trail (who changed
  what, when, which version) from `audit_log`; linked from the workspace rail.

## Deferred
Full document-intelligence upload→extract→confirm UI (the extraction pipeline
reuses `pdf2json`/`exceljs`; the data-quality surface is in place to receive it) ·
LTC/estate schema depth · richer conflict-resolution UI. These deepen the documents
and estate surfaces already shipped without reshaping the model.

## Verification
type-check ✓ · lint ✓ · `npm test` ✓ (adds prefill 4) · RLS proof ✓ (18/18) ·
build ✓ (protection/estate/documents/audit routes compiled).
