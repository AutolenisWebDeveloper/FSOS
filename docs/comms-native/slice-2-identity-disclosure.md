# Native Communications Platform — Slice 2: First-Contact Identity Disclosure Engine

> Vertical slice per master build instruction §4 (Slice 2 of 9). Authoritative rationale: **ADR-016**.
> Extends `lib/comms` + `/app/comms` in place (§0) — no parallel platform, no second gate, no GHL touched (§0.A).

## What shipped

| Concern | Delivery |
|---|---|
| **Decision core (pure)** | `src/lib/comms/identity.ts` — `evaluateIdentityDisclosure` (per-channel full-intro triggers §8), `renderIdentityDisclosure` (configurable wording), `prependIdentityDisclosure` (idempotent compose). Clock-injected, offline-tested. |
| **Editable, approval-gated wording** | `comm_identity_config` (mig 053): full/abbreviated templates + Farmers role label + inactivity window + version + approval. Seeded as a **config default** (`is_assumption=true`, gold badge) in `draft` — nothing auto-discloses until approved (§4.3). |
| **Per-channel state** | `comm_conversations` gains `identity_disclosed_at` / `_version` / `_sender_user_id` / `_purpose` (one thread = one channel). `comm_messages` records `identity_full_intro`, `is_first_channel_touch`, `identity_disclosure_version`, `identity_disclosure_reason`. |
| **Platform auto-insertion** | `identity-resolver.ts` (fail-safe DB adapter) + `send.ts`: when a full intro is required **and** an approved config exists, the platform auto-prepends the disclosure to the personalized body **before the gate runs**, then records the per-channel state after a successful send. Never fabricates wording. |
| **Config surface** | `/app/comms/identity` (status + gold assumption badge + live preview + editor, all states) + `/api/comms/identity` (GET; POST save/approve — Zod, server-authorized, audited). |

## Per-channel + author-proof (the two §8 invariants)

- **Per channel:** a first email never satisfies a first SMS — `channelAlreadyTouched`/`priorDisclosedAt` are read from the per-channel conversation.
- **Author-proof:** the platform decides and inserts; the author never adds the disclosure. On an established thread the abbreviated form is *allowed* (not forced), so established-thread bodies are unchanged.

## Full-intro triggers (§8), all covered by the pure test
first-ever touch on the channel · new campaign · new purpose · different sender · agency-owner/contact-owner reassignment · inactivity beyond the configured window · "who is this?" · prior disclosure unconfirmable. Otherwise → abbreviated.

## Scope boundary (read before reviewing)
Enforcement is **opt-in** via `SendContext.identity`. Existing send paths pass nothing → unchanged. Turning it on for delegated outreach (and enriching the `newCampaign`/`reassignment` hints from history) is the campaign-builder slice (§15). Auto-insertion is additionally gated on an **approved** config, so unverified Farmers wording never reaches a client.

## Evidence
- `tests/comms-identity.test.mjs` — 16 assertions: every full-intro trigger, per-channel independence, inactivity boundary, render structure (names actual sender + represented agent, never impersonates), config-sourced Farmers label, idempotent prepend.
- `tests/rls-firewall.test.mjs` (extended) — applies mig 033+051 to ephemeral Postgres; proves a client sees **0** `comm_identity_config` rows (back-office default-deny). 10/10.
- `npm test` (+identity) · `type-check` · `lint` · `test:rls` · `build` — all green.

## Guardrails touched
Disclosure is prepended before the gate, so it is consent/quiet-hours/recommendation/securities checked like any content (ADR-003/004). No securities substance stored. Gold assumption badge on the config default. Append-only audit on save/approve. GHL untouched (§0.A).
