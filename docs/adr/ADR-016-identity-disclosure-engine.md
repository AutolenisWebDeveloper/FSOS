# ADR-016 — First-Contact Identity Disclosure Engine

**Status:** Accepted
**Date:** 2026-07-23
**Owner:** FSOS Engineering
**Related:** ADR-003 (single dispatcher), ADR-004 (securities firewall), ADR-015 (delegated authority + actual-sender/represented-party); CLAUDE.md §4.2, §4.3; master build instruction §8.

## Context

FSOS's model is B2B2C: a licensed FSA communicates with an agency owner's clients **on behalf of** that agency owner (ADR-015). Every first contact must clearly disclose **who is actually reaching out** and **on whose behalf**, and must never imply the FSA is the customer's own agent or the agency owner (master build instruction §8). Getting this wrong is a compliance and trust failure.

The requirement is that the **platform** inserts the approved disclosure automatically — a campaign author must never be responsible for remembering it. The disclosure is **per channel** (a first email does not satisfy the first SMS), and after identity is established on a channel, follow-ups **may** use an abbreviated form until a refresh condition recurs (new sender, new purpose, reassignment, inactivity, "who is this?", or an unconfirmable prior disclosure).

Two hard constraints from the contract: the exact Farmers legal/brand entity wording is **not** publicly verified, so it must ship as an **editable, approval-gated config default** (§4.3), never a hard-coded string; and any disclosure text is prepended **before** the compliance gate runs so the full message is validated (ADR-003, ADR-004).

## Decision

**1. A pure decision + rendering core: `src/lib/comms/identity.ts`.** `evaluateIdentityDisclosure` decides, per channel, whether a **full** introduction is required (first-ever touch on this channel, new campaign, new purpose, different sender, reassignment, inactivity beyond the configured window, the contact asked who is calling, or a prior disclosure that can't be confirmed) or the **abbreviated** form is allowed. It is clock-injected and exhaustively unit-tested offline, mirroring `gate.ts`/`delegation.ts`. `renderIdentityDisclosure` fills the approved, **configurable** templates with only the registered identity tokens; `prependIdentityDisclosure` composes disclosure + body idempotently.

**2. Editable, approval-gated config: `comm_identity_config` (migration 053).** A singleton carrying the `fsa_role_label`, the `full_template`, the `abbreviated_template`, the `inactivity_days` window, a `version`, an `approval_status`, and `is_assumption`. It is seeded with the §8 default structure as a **config default** (`is_assumption=true` → gold "config default — verify" badge) in `draft` status. **Nothing is auto-disclosed until the config is approved** — the FSA verifies the wording, then approves. Editing bumps the version and resets approval, so a changed disclosure can never auto-send before re-approval.

**3. Per-channel state on the conversation.** One thread = one channel (`comm_conversations` unique on `(channel, contact)`), so the per-channel disclosure state lives on the conversation: `identity_disclosed_at`, `identity_disclosure_version`, `identity_sender_user_id`, `identity_purpose`. `comm_messages` records what each send disclosed: `identity_full_intro`, `is_first_channel_touch`, `identity_disclosure_version`, `identity_disclosure_reason`. All additive/nullable.

**4. Platform auto-insertion in `send.ts` (opt-in this slice).** When a caller supplies `SendContext.identity`, `send.ts` resolves the decision fresh (`identity-resolver.ts` → the pure core), and when a full intro is required **and an approved config exists**, auto-prepends the rendered disclosure to the (personalized) body **before** the gate runs — so the disclosure is compliance-checked with the rest of the message. After a successful full-intro send it records the per-channel state on the conversation. The resolver **fails safe toward more disclosure**: unknown state (lookup failure / missing conversation) is treated as first touch. It **never fabricates** the Farmers wording — if no approved config exists, the need for a full intro is recorded on the message (`identity_disclosure_reason`) but nothing is auto-inserted.

**5. Config surface.** `/app/comms/identity` (view status + gold assumption badge + live preview + editor) and `/api/comms/identity` (GET; POST `save`/`approve`, Zod-validated, server-authorized, audited).

### Amendment (2026-08-07) — authored introductions, insertion point, and the inactivity signal

Three corrections, all preserving the decision above. The disclosure **requirement** is unchanged; only *which* approved wording is delivered, *where* it is placed, and *when* it refreshes.

**6. An approved authored template may carry the introduction (`comm_templates.introduces_sender`, migration 105).** The lifecycle campaigns open their first email/SMS/AI touch with an introduction of their own, so the platform prepend produced **two** near-identical introductions on one message. A template may now declare `introduces_sender = true`; `resolveIdentityDisclosure` then returns `satisfiedByBody: true` — it records the introduction (`identity_full_intro`, the audit reason) and `send.ts` still stamps the per-channel thread state, but nothing is prepended. Every later touch therefore correctly reads as "already introduced" and never re-introduces. The default is `false`, which prepends exactly as before, so the fail-safe direction is unchanged and a caller that forgets the flag over-discloses rather than under-discloses. Decision 4's guarantee holds either way: the introduction is still gate-checked, still recorded, and still cannot be silently omitted — a body that claims the flag but drops the introduction is caught by `tests/lifecycle-campaign-messaging.test.mjs`, which asserts that exactly one asset per channel carries it and that its copy actually names the FSA, their role, and the recipient's agent of record.

**7. The disclosure is the first *paragraph*, not the first *line*.** A campaign email body opens with `Subject:`/`Preview:` routing headers that `email-shell.ts` parses into the card H1 and inbox preheader. Blindly prepending pushed them out of the leading-header window, so the email lost its heading and rendered a literal "Subject: …" as body copy. `prependIdentityDisclosure` now skips past those headers and past a standalone greeting line. SMS is unaffected (no headers, no standalone greeting).

**8. Inactivity is measured from the thread's last message, not the age of the disclosure.** Ageing off `identity_disclosed_at` re-introduced the FSA in the middle of a live campaign purely because the campaign had been running longer than the window — the opposite of the rule's intent, which is to refresh when a *relationship* has gone cold. `IdentityInput` takes `lastContactAt` (`comm_conversations.last_message_at`) and falls back to `priorDisclosedAt` when the thread has no recorded traffic.

**9. One agent-of-record phrasing helper.** `agentOfRecordReference()` in `identity.ts` renders "your Farmers agent, Jane Smith" when the name is on file and the approved generic "your Farmers agent" when it is not. It backs both the disclosure's `{{agency_owner.reference}}` and the new `{{agent_of_record_reference}}` merge variable, so campaign copy and platform disclosure cannot drift, and neither ever guesses a name (§4.3).

## Rationale

- **Author-proof by construction.** The platform, not the author, decides and inserts the disclosure — the exact failure §8 is guarding against (a forgotten introduction) can't happen on a governed send.
- **Never invent regulated wording.** The Farmers entity/role label and templates are editable config defaults with an assumption badge and an explicit approval gate (§4.3). Auto-insertion is disabled until approved, so unverified wording never reaches a client.
- **Pure core, DB adapter.** The decision is pure and fully tested; the resolver is a thin, fail-safe DB adapter — the same pattern as the gate and the delegation engine.
- **Gate-checked disclosure.** Prepending before dispatch means the disclosure passes consent/quiet-hours/recommendation/securities like any other content (ADR-003/004).

## Alternatives Considered

- **Require authors to include the disclosure token in templates** — rejected: it reintroduces the exact "forgot the introduction" risk §8 forbids, and can't be enforced.
- **Hard-code the Farmers wording** — rejected: the exact legal/brand wording is unverified (§4.3); it must be an editable, approval-gated config default.
- **Track identity globally per contact (not per channel)** — rejected: §8 is explicit that disclosure is per channel (a first email does not satisfy a first SMS). The conversation (one per channel) is the natural home.
- **Auto-insert with the seeded default even before approval** — rejected: that would send unverified wording to clients; auto-insertion is gated on an explicit approval.

## Consequences

**Positive**
- First-contact disclosure is authoritative, per-channel, gate-checked, auditable, and impossible for an author to forget on a governed send.
- The regulated wording is editable and approval-gated; nothing unverified auto-sends.
- Primitives (engine, config, per-channel state, message flags) are in place for later slices to activate broadly.

**Negative / trade-offs**
- Enforcement is opt-in this slice (`SendContext.identity`); existing send paths are unchanged until the campaign-builder slice (§15) turns it on for delegated outreach — documented so reviewers don't read it as "every send now discloses."
- `newCampaign` and `reassignment` are caller-supplied hints (the conversation doesn't yet store last-campaign / reassignment history); first-touch, sender-change, purpose-change, and inactivity are fully DB-derived. A later slice can enrich the hints.

## Related Documents

- CLAUDE.md §4.2, §4.3; master build instruction §8
- ADR-003, ADR-004, ADR-015
- Migrations `supabase/migrations/053_comm_identity_disclosure.sql`, `094_identity_disclosure_agent_of_record.sql`, `105_comm_template_introduces_sender.sql`
- `src/lib/comms/identity.ts`, `identity-resolver.ts`, `variables.ts`, `send.ts`
- Tests: `tests/comms-identity.test.mjs`, `tests/comms-variables.test.mjs`, `tests/lifecycle-campaign-messaging.test.mjs`, `tests/rls-firewall.test.mjs` (extended)
- `docs/comms-native/slice-2-identity-disclosure.md`
