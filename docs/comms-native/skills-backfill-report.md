# Skills Backfill Report — Native Communications Platform (Slices 1–6)

> Standalone docs/skills change required before Slice 7 by the master build instruction's
> standing SKILLS requirement ("BACKFILL FIRST"). This report reviews every merged PR from
> Slices 1–6, records which project skills were extended and why, and states what durable
> knowledge was intentionally left in code (not skills). **Slice 7 does not begin until this
> merges.**

## Scope reviewed

Every merged PR on `claude/fsos-communications-platform-s37vlh` for Slices 1–6:

| Slice | Feature | Merged PRs |
|---|---|---|
| 1 | Ownership resolution + delegated agency-owner outreach (actual-sender / represented-party) | #107, #108, #110 |
| 2 | First-contact identity-disclosure engine | #113, #115 |
| 3 | Policy-engine extensions: purpose classification, frequency caps, priority collision | #118, #119 |
| 4 | Conversation mode (a reply pauses promotional automation) | #121 |
| 5 | AI authority matrix + communication evaluations (§11/§12) | #122 |
| 6 | Data confidence & source verification (§13); simulation mode (§14) | #123, #124 |

Skills inventoried against this work: `twilio-a2p-compliance`, `fsos-crm-workflows`,
`supabase-postgres-best-practices`, `fsos-security-audit`, `frontend-design`, `test-driven-development`.

## Skills changed

### 1. `twilio-a2p-compliance` (OWNS the gate / dispatcher / send path) — extended

The most important correction: the skill still described **"the 7-step gate is the law."** Slices 1–6
grew the one gate to **13 ordered steps**, so the skill was stale on the single most load-bearing
fact in the subsystem. Extended with:

- **The full 13-step ordered gate** (ownership → consent → quiet_hours → business_hours → delegation →
  dnc → approved_template → recommendation → is_security → data_confidence → other_rule → frequency →
  collision), each tagged **escalating compliance block** vs **operational deferral**.
- **Two durable invariants** learned across the slices: (a) escalating compliance blocks run *before*
  the operational deferrals (frequency/collision are LAST) so a real violation can never be masked by a
  non-escalating deferral; (b) every gate input added after the original 7 is **default-permissive**, so
  a new dimension is opt-in per call site and existing sends are never silently changed.
- **The build pattern for a new gate dimension**: pure decision core (clock-free/DB-free, offline-tested)
  → DB resolver (fail-closed, scoped-then-fallback) → opt-in `send.ts` wiring via a `ctx.*` field. This
  is how all of Slices 1–6 were built and is the reuse template for Slices 7–9.
- **AI auto-send authority (§11/§12)**: a code-assigned class → `auto_send | draft_only | blocked`,
  unknown ⇒ draft-only fail-safe; a prompt cannot make the AI auto-send securities/advice.
- **Simulation-before-activation (§14)**: read-only, shares the same pure gate (safe by construction),
  activation 422s without a recent simulation.
- **The `ON CONFLICT` / partial-index hazard** (migration 054→055): a *partial* unique index cannot be an
  `ON CONFLICT` arbiter, so swapping the `consents unique(member_id, channel)` constraint for partial
  indexes silently broke every STOP/START opt-out upsert. The per-purpose axis belongs in the companion
  table `comm_consent_purposes`, leaving the channel-wide upsert arbiter intact.
- Refreshed authoritative-sources + tests lists to include every comms-native module and test core.

### 2. `fsos-crm-workflows` (OWNS campaigns / enrollments / agents) — extended

Added a **"Native communications: campaigns, enrollments, and the conversation lifecycle"** section
capturing the CRM-side (non-send-path) knowledge from Slices 4 and 6:

- Enrollment lifecycle drives the drips: `dripAdvance` selects only `status='enrolled'`, so pausing an
  enrollment is a *structural* "no follow-up after reply," not a heuristic.
- A reply pauses promotional automation (`inbound.ts` → `paused_for_conversation`); deferred resume via
  the `resume-paused` cron running the pure `evaluateResume` against the editable `comm_conversation_policy`.
- Simulation is required before a campaign can activate (422 `simulation_required`).
- Delegated agency-owner outreach (actual-sender vs represented-party; unresolved ownership → assignment
  review) and the rule that **GoHighLevel stays frozen** during comms work.
- Added an RLS note: new comms tables need `grant select … to authenticated` so the RLS firewall proof
  denies by row rather than erroring on a missing grant.

## Skills intentionally left unchanged (and why)

- **`supabase-postgres-best-practices`** — a vendored, externally-maintained MIT skill (author: Supabase,
  versioned). Its FSOS-specific lesson (the `ON CONFLICT`/partial-index hazard, `grant select` for RLS
  proofs) was recorded in the FSOS-owned skills above instead of forking a third-party skill.
- **`fsos-security-audit`** — the RLS-firewall-proof discipline it already prescribes covered every slice
  unchanged (each migration extended `tests/rls-firewall.test.mjs`); no new pattern to add, so it stays as-is.
- **`frontend-design`** — the simulate/assignment-review/identity-config controls used existing archetype
  shells and tokens; no new design pattern was introduced (that would have required a `DESIGN.md` change).
- **`test-driven-development`** — the offline pure-core compile-and-`require` method is a *how-to-test*
  detail specific to these modules; it is documented in `twilio-a2p-compliance` (where the cores live)
  rather than generalized into the TDD skill.

## Knowledge deliberately kept in code / docs, not skills

Per the standing requirement, feature-specific state does **not** go into skills. Left where it belongs:

- **Migrations 049–057** — application schema, not skill content.
- **ADR-015 … ADR-021** — the *why* of each slice lives in its ADR (the skill links to them).
- **Per-slice specifics** (exact class lists in `ai-authority.ts`, the identity-disclosure copy, the
  purpose→consent mapping table) — feature code; the skill points to the module rather than restating it.
- **PR-review fixes** (e.g. #108/#110/#115/#119 hotfix details) — captured as the *generalized* invariant
  in the skill (fail-closed resolvers, gate ordering, upsert-arbiter hazard), not as PR notes.

---

## Slices 7–9 backfill (added later)

> The Slices 1–6 report above covered through migration 057 / ADR-021. Slices 7–9 shipped the
> builder config, the campaign library, data-confidence claim wiring, email rendering, and the
> Slice-9A AI Communications Center. This section records the durable knowledge captured into the
> two owning skills for that work.

### Scope reviewed (Slices 7–9)

| Slice | Feature | ADR / migration |
|---|---|---|
| 7 | Campaign + sequence builder config: message `purpose` + delegated-sender storage | ADR-022 / migration 058 |
| 8 | Campaign library (pre-built compliance-ready blueprints); data-confidence **claim wiring** (declaration + resolver) | ADR-023, ADR-024 / migration 059 |
| 9 | AI Communications Center (Slice 9A overview + `CommsSubnav`); email rendering (author-time React → stored immutable HTML+plaintext) | ADR-025 / migration 061 |

### Skills changed

**1. `fsos-crm-workflows` (OWNS campaigns / enrollments) — extended.** Added to the "Native
communications" section (CRM-side, non-send-path):

- **Builder config (ADR-022, `campaign-config.ts`):** the builder stores a message `purpose` and an
  optional delegated-sender pairing (`represented_agency_owner_id` + `delegation_id`); both
  default-permissive; a partially-configured delegation is NOT delegated; the delegation row is
  resolved fresh at dispatch (`ownership.ts`), never trusted from the snapshot.
- **Campaign library (ADR-023, `library.ts`; `/app/comms/library`):** version-controlled, green-zone,
  footer-free, purpose-tagged blueprints; "Add to templates" seeds a DRAFT that still passes human
  approval — the gate is never bypassed. Reuse `listBlueprints`; don't hardcode a second set.
- **Claim-field wiring (ADR-024, `claims.ts` + `claim-resolver.ts`):** a campaign declares the
  per-recipient claim fields (`conversion_deadline`, `policy_status`, `appointment_at`); the read-only
  resolver derives verified/conflicting state fail-closed; `buildDataConfidence` feeds the gate's
  `data_confidence` step. No declared claims ⇒ never blocked by that step.
- Updated authoritative-sources: migrations `049–061`; ADRs `013–025`; the `library.ts` / `claims.ts` /
  `claim-resolver.ts` / `campaign-config.ts` modules and the `library/`, `assignments/`, `identity/`,
  `inbox/` surfaces.

**2. `twilio-a2p-compliance` (OWNS the gate / send path) — extended.**

- **Corrected the gate order** to match the current `evaluateGate`: `business_hours` moved out of the
  early escalating block and down to the trailing **operational deferrals** (now steps 11–13:
  business_hours → frequency → collision), so an escalating compliance trip evaluated outside operating
  hours can never be masked as a benign "held for hours" deferral. Fixed the two off-by-one step numbers
  in the A2P rules (`is_security` = step 8, recommendation = step 7). Pointed the skill at
  `docs/data-guardrails.md` §5 as the canonical enumeration.
- **Added a data-confidence claim-gate section** (declaration `claims.ts` → resolver `claim-resolver.ts`
  fail-closed → `data_confidence` gate input; library blueprints declare, wiring resolves).
- **Added an email-rendering section (ADR-025):** author-time-only react-email (devDependency); the send
  path never renders React; deterministic stored HTML + plaintext (`render_sha` / `body_text`,
  `npm run templates:build`); the immutable-approval contract (changed bytes bump `version` + reset to
  draft); multipart send via `ctx.bodyText`.
- Extended the Authoritative Sources / Schema / Tests lists through **ADR-025 / migration 061**, and
  added the `comms-campaign-config`, `comms-claims`, `comms-library`, and `email-determinism` tests.

### Left in code / docs, not skills (Slices 7–9)

- **Migrations 058–061** and **ADR-022…ADR-025** — schema + the *why*; the skills link to them.
- **The blueprint bodies / claim-field derivation logic / email components (`src/emails/*`)** — feature
  code; skills point to the module rather than restating it.
- **Slice-9A overview page + `CommsSubnav`** — a UI surface; the reusable design rule (in-hub grouped
  sub-navigation, fully token-based, no new variant) was recorded in `DESIGN.md` §12, not a skill.

---

## Verification

Skills + docs only — no source, schema, or test behavior changed. `npm run build`, `type-check`, `lint`,
`npm test`, and `npm run test:rls` remain green (unchanged from #124 for Slices 1–6; Slices 7–9 doc/skill
edits change no source, schema, or test).
