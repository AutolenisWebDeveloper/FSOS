# FSOS Native Communications Platform & GoHighLevel Decommission — Migration Docs

> **Purpose.** This folder is the discovery + planning foundation for completing FSOS as a
> native, self-contained communications platform (FSOS + Twilio + Resend) and decommissioning
> GoHighLevel (GHL). These documents are the **migration's safety net** (master build
> instruction §4): every later slice — especially the destructive GHL stages — depends on the
> facts recorded here. They are repo-grounded and were verified against the live code, not the
> brief's claimed numbers.

## Scope of this foundation slice

Per the master build instruction §16 ("Do not begin by writing migrations or UI. First produce
the current-state map and the GHL footprint audit, then the implementation plan and ADRs"), this
slice delivers **documentation and decision records only** — it changes no runtime code, schema,
or UI. It is the prerequisite for the D0 export slice and everything after it.

## Contents

| Document | What it is |
|---|---|
| [`ghl-footprint-audit.md`](./ghl-footprint-audit.md) | Exact, file-level GHL footprint: libs, routes, the load-bearing webhook, migrations, tables/columns, env vars, the `ghlEnabled()` flag, hardcoded IDs, outbound origin, UI entry points. The D3/D5 removal checklist and D0 gate. |
| [`comms-platform-inventory.md`](./comms-platform-inventory.md) | The existing native comms platform to **extend**: the 14 `lib/comms` modules, the single send path, the 7-step gate, cron topology, webhooks, the `/app/comms/*` UI + `/api/comms/*` API, the communication-flow inventory, and the env-var inventory. |
| [`data-model-inventory.md`](./data-model-inventory.md) | The `comm_*` family DDL, the 006-vs-`comm_*` duplication, `consents`/`consent_ledger`/`dnc_entries`, ownership keys, RLS + the CI firewall proof, workshop comms tables, GHL provenance columns, and the dead-route report. |
| [`feature-parity-matrix.md`](./feature-parity-matrix.md) | §2.B deliverable: every GHL-provided capability classified Remove / Replace / Extend / Archive, with where-it-lives, replacement, and verification test. **Must be approved before D3.** |
| [`implementation-plan.md`](./implementation-plan.md) | The 11 vertical slices (D0 → §13) with per-slice schema/backend/API/UI/test/verification shape, extend-before-build search notes, and the ordering constraints. |

## Governing decisions

- **ADR-013 — Canonical `comm_*` model.** The `comm_*` family is the single canonical
  communications data model; the legacy `006` `campaigns`/`campaign_enrollments` engine is a
  frozen deprecation surface to be drained then retired. No third family.
- **ADR-014 — GoHighLevel decommission.** Ordered D0–D5 removal, data-preservation-first,
  rollback mandatory, network-level decommission proof.

## Authority order (CLAUDE.md §1)

`CLAUDE.md` + `/docs` → `DESIGN.md` → accepted ADRs → the live repo → installed skills → the
master build instruction. Where the brief conflicts with `CLAUDE.md`, **`CLAUDE.md` wins**;
conflicts are documented (e.g. the env-var count correction in the footprint audit).

## Key facts that shape everything downstream

1. **Only 3 real GHL env vars** (`GHL_API_KEY`, `GHL_LOCATION_ID`, `GHL_WEBHOOK_SECRET`); the
   other six names in the brief are TypeScript constants, not env vars.
2. **The GHL webhook writes to legacy tables** (`customers`, `commission_cases`, `activity`,
   `consent_ledger`), not the aggregate-root spine — a reconciliation D1 must resolve.
3. **The only pipeline→commission-case trigger** is the GHL `OpportunityStageUpdate` handler.
   It must be replaced natively before removal.
4. **Opt-out capture has two paths already** — native Twilio-STOP/Resend-unsubscribe
   (`inbound.ts` → `consents` + `dnc_entries`) and the GHL webhook. The GHL one is secondary but
   must not be lost.
5. **The send path is a single choke point** (`sendThroughGate → dispatch → evaluateGate →
   messaging.ts`); providers are reached only through it. All new sending extends this path.
6. **The gate is pure and additive** — the §6–§10 policy extensions (delegation, identity
   disclosure, frequency caps, purpose classification, data confidence) are new `GateStep`s +
   `GateInput` fields, not a rewrite.
7. **Conversation-mode pause-on-reply is genuinely net-new** — no drip-suppression-on-human-reply
   exists today; only STOP halts sends.
