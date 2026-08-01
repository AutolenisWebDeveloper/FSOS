# ADR-033 — Communications Command Console (orchestration over the one send path)

**Status:** Accepted
**Date:** 2026-08-01
**Owner:** FSOS Engineering

## Context
The FSA needs a single operator console to (1) send an individual SMS or email, (2) reuse
any communication asset from any campaign, (3) initiate an AI conversation with a chosen
agent, and (4) run a real per-campaign test send. FSOS already has one production send path
(`sendThroughGate` → `evaluateGate` 7-step → `dispatch` → `comm_messages`) and one
communications dispatcher (ADR-003). The risk in adding an operator console is
architectural fragmentation: a second send path, a second consent check that disagrees
with the gate (ADR-013/§12), or a "force-send" override that bypasses the guardrails.

## Decision
The console is an **orchestration + UI layer over the existing rails — not a new send
path.** Every outbound message it produces (manual, asset-sourced, AI-initiated, or test)
goes through the same `sendThroughGate()` and the same 7-step gate. There is no override
control anywhere on the surface.

Concretely:
- **Send provenance** is descriptive metadata on `comm_messages` (`source_kind`,
  `source_campaign_key`, `source_asset_id`, `source_asset_table`, `is_test`) — it never
  affects the gate.
- **Cross-campaign catalog** is a single read-only view `comm_sendable_assets` normalizing
  every campaign's touch rows + the template library to one shape. A new campaign is added
  to the picker by adding exactly one `union all`. `template_id` is the render + gate handle;
  `advisor_outreach` touches (which produce a work_task, not a send) are excluded.
- **Blank compose** uses the `humanAuthored` path (a licensed operator authoring a 1:1
  message is the content approval for gate step 4) plus a seeded, approved **ad-hoc**
  `comm_template` per channel so the email opt-out footer resolves. Recommendation language
  is still hard-blocked at gate step 5.
- **Campaign-asset send** re-resolves the asset **server-side** from the catalog, so the
  operator cannot substitute a body and the approved template that satisfies the gate is the
  asset's real template.
- **AI initiation (B1)** creates the one `(channel, contact)` conversation with
  `origin='outbound_manual'` + a bound `agent_key`, sends the opener through the gate as an
  `aiGenerated` message (so the AI-authority matrix + §12 evaluations run), and only arms
  `ai_autoreply` on a successful send. Securities-flagged contacts and the Compliance
  Guardrail agent are never eligible.
- **Test send (B4)** is a real gated send to a **verified destination the operator owns**
  (`comms_test_recipients`, owner-scoped RLS), flagged `is_test=true` so production analytics
  exclude it. It never enrolls, never advances a campaign, and never bypasses the gate.
- **`is_test` is not accepted by `POST /api/comms/send`.** A test can only be produced by
  `POST /api/comms/test`, which enforces the verified-self allowlist. This closes the only
  way the "test excludes from analytics / can't reach a client" guarantee could be abused.
- **Consent source is the gate's source only.** The console never adds a divergent consent
  check (ADR-013/§12). To make a test to an operator's own device actually exercise the
  pipeline, registering a test destination records the operator's self-consent for that
  device — legitimate consent, not a bypass.

## Rationale
Reusing the one send path is what keeps the three guardrails (§4), the dispatcher (ADR-003),
the AI authority matrix (ADR-019), and the communications compliance gate (§12) authoritative
for the console with zero duplication. The provenance-plus-view approach adds cross-campaign
reuse structurally (one `union all` per campaign) rather than as scattered special cases.

## Alternatives Considered
- **A dedicated console send path** — rejected: it would clone the dispatcher/gate and create
  a second place for a compliance rule to drift (§6).
- **A live gate pre-check chip that computes consent/DNC/quiet-hours itself** — deferred: the
  gate's context computation lives in `send.ts`; a standalone pre-check would re-implement
  those lookups and risk a second consent read that disagrees with the gate (§1/§12). The
  console instead surfaces the gate's real result on send/test (failing step + reason, no
  override). A future pre-check must reuse the gate's own context computation.
- **`is_test` on `/api/comms/send`** — rejected as an abuse vector (see Decision).
- **A writable per-campaign asset index table** — rejected in favor of the read-only view.

## Consequences
**Positive**
- One send path, one gate, one consent source, one dispatcher preserved (§6).
- Cross-campaign reuse is structural; new campaigns join the picker with one `union all`.
- Test sends prove the whole pipeline (real gate) without touching production data.

**Negative / trade-offs**
- Campaign **email** assets have no subject column on `comm_templates`; the console renders
  body/plaintext and takes the subject from the asset name or the operator (known limitation;
  subject-from-render-registry is a follow-up).
- The live gate pre-check chip (§5.1) is deferred to avoid a divergent consent read.
- Test-destination verification proves control of the device via a gated one-time code; a
  fully out-of-band verification channel is a future enhancement.

## Related Documents
- CLAUDE.md (§4 guardrails, §6 architecture preservation, §12 communications compliance)
- docs/adr/ADR-003-communications-dispatcher.md, ADR-004-securities-firewall.md
- docs/adr/ADR-013-comms-data-model.md, ADR-019-ai-authority-matrix.md
- supabase/migrations/087_comms_console.sql
- src/lib/comms/console.ts, src/lib/comms/assets.ts, src/app/(fsa)/app/comms/console/
