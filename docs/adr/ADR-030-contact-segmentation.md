# ADR-030 — Contact segmentation (the targeting layer)

**Status:** Accepted
**Date:** 2026-07-26
**Owner:** FSOS Engineering

## Context

The three life campaigns (Cross-Sell, Life Conversion, Win-Back) need a reusable
targeting layer that resolves *which* contacts to enroll, with a visible eligible-vs-
excluded breakdown before anyone is enrolled. FSOS already has the pieces: a saved-
definition catalog (`comm_audiences`, free-form `definition` jsonb), a member-keyed
enrollment engine (`resolveAudience` → `dispatchCampaign`, enrolling
`household_members.member_id`), the household signals `v_cross_sell_gaps` /
`v_conversions_due`, a win-back contact subset (`source='winback_life'` / tag
`life-winback`), and — after Slice 3 — `household_members.source_contact_id`, the
contact↔member bridge. Consent, DNC, and quiet-hours are already enforced per
recipient at the dispatcher gate.

What's missing is a *contacts-based* segment: rules over contact fields (+ a campaign
preset), a resolver that produces the live breakdown, and a way to enroll the exact
contacts a segment selects rather than whole households.

## Decision

1. **Segments are rules over contacts, evaluated dynamically.** A `SegmentRule`
   (`src/lib/segments/rules.ts`) filters on `contact_type`, `tags`, `source`, `state`,
   `owner_scope`, completeness, and an optional campaign `preset`. Membership is a
   **pure** function (`matchesRule`); eligibility (can we enroll/send now?) is a pure
   function of gathered signals (`classifyEligibility`). Segments re-resolve on read,
   so a newly-cleaned or newly-materialized contact appears in the right audience with
   no rebuild.

2. **No new schema, no forked catalog.** `comm_audiences.definition` is free-form
   jsonb, so a `base: 'contacts'` segment needs **no migration** — only the Zod edge
   (`SegmentRuleSchema`, the campaign `audience` enum, `AudienceCreateSchema`). The
   existing `comm_audiences` catalog and `estimateSize` are extended, not replaced.

3. **The three campaign segments are first-class presets.** `SEGMENT_PRESETS`
   (cross_sell → `v_cross_sell_gaps`, life_conversion → `v_conversions_due` with
   `is_security=false`, win_back → win-back contacts). Each resolves to a live
   breakdown — total, eligible, excluded, and reason counts (`no_household`,
   `no_contact_method`, `no_consent`, `suppressed`, `incomplete`) — surfaced at
   `GET /api/app/segments` so the FSA sees exactly who a campaign will reach.

4. **One enrollment path, no parallel one.** Enrollment flows through the existing
   engine: `resolveAudience` gains a `kind: 'contact_segment'` branch that resolves the
   segment to its **eligible member ids** (via `source_contact_id`) and enrolls those
   specific members — not whole households. The gate, `comm_campaign_enrollments`
   idempotency, the drip cron, and simulation are all reused unchanged.

5. **Preview classifies; the gate enforces.** The resolver's exclusions are guidance
   shown before enrolling. The securities firewall, consent, DNC, and quiet-hours
   remain enforced per recipient at the dispatcher gate at send time — the segment
   never bypasses them, and a `contact_segment` inherits that enforcement for free.

## Rationale

Optimizes for reuse over a new subsystem (§6): the catalog, the engine, the gate, and
the household signals are all extended. Splitting membership (pure, tested) from
eligibility (signal-driven) makes the correctness core unit-testable without a
database and keeps the compliance decision where it already lives — the gate.
Enrolling by member id (not household) means a campaign reaches the segmented contacts
exactly, which the `source_contact_id` bridge from Slice 3 makes precise.

## Alternatives Considered

- **A new `contact_segments` table + parallel enrollment.** Rejected — forks the
  audience catalog and the enrollment path (§6). `comm_audiences` jsonb already holds
  the definition; the engine already enrolls members.
- **Enroll whole households for a contact segment.** Rejected — over-reaches to
  household members the segment didn't select. Member-id enrollment via
  `source_contact_id` is exact.
- **Re-enforce consent/DNC in the resolver as the gate.** Rejected — duplicates the
  dispatcher gate and risks divergence. The resolver classifies for preview; the gate
  is the single enforcement point.

## Consequences

**Positive**
- Reusable, dynamic targeting layer; the three campaign segments show accurate live
  counts with exclusion reasons before enrollment.
- No migration; no parallel model or enrollment path.
- Correctness core (membership, completeness, eligibility) is pure and unit-tested.
- Newly-cleaned contacts (Slices 1–3) automatically flow into the right segment.

**Negative / trade-offs**
- Resolving a segment issues a few batched reads (contacts + members + consents);
  bounded by `CANDIDATE_CAP` and chunked `.in()` — acceptable for a preview/enroll,
  and cheaper than per-recipient work at send.
- Preview "suppressed" covers `do_not_contact` + revoked consent; exact `dnc_entries`
  matching stays at the gate (documented), so a preview eligible count can be a slight
  over-count that the gate then blocks — safe direction (never an under-count that
  hides someone).
- No `contacts.last_activity_at` yet, so a last-activity rule is out of scope here
  (would need an `activities` aggregate or a new column) — noted for a later slice.

## Related Documents
- CLAUDE.md §6 (architecture preservation), §11/§12 (AI + comms compliance), §10 (aggregate root)
- docs/adr/ADR-003-communications-dispatcher.md, ADR-028, ADR-029
- src/lib/segments/rules.ts, src/lib/segments/resolve.ts, src/lib/comms/campaign.ts (resolveAudience)
- src/app/api/app/segments/route.ts, src/app/api/comms/audiences/route.ts
- Forward: Slice 6 — the segment-manager UI (create/edit/preview, launch a campaign from a segment)
