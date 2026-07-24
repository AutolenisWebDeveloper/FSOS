# ADR-025 — Social Content Module (draft→approve→publish→track)

**Status:** Accepted
**Date:** 2026-07-24
**Owner:** FSOS Engineering

## Context

FSOS needs an owner-authorized capability to run the FSA's social presence the same
way it runs every other regulated surface: **AI drafts → a human approves → the system
publishes on a schedule → engagement flows back into the CRM.** A repo-wide search
confirms there is **no existing Social Engine** — the only `social` matches are footer
icons, the legacy command center, and an unrelated Apollo reference. This is therefore a
**greenfield module inside the existing application**, not a new app and not a parallel CRM.

Forces and constraints:

- **Regulatory.** FSOS is operated by a FINRA-registered representative. Social posts are
  *retail communications*: static content requires **principal pre-approval before use**;
  interactive content is supervised. The module must be **draft-and-approve by design** —
  the AI never publishes unreviewed content, and every published post retains its approved
  version, approver, and timestamp. This is the same authority pattern the comms platform
  already uses (ADR-015, ADR-019).
- **Platform API reality.** Only some platforms permit API posting, each with a different
  shape and approval regime: YouTube (full API), Facebook Page (Graph API + app review),
  Instagram (Business/Creator + linked Page + Graph API), LinkedIn **Company** Page
  (Marketing Developer Platform, approval-gated), X (paid API), TikTok (limited, approval).
  LinkedIn **personal** profiles and personal-account posting are **not** available.
- **Browser automation is prohibited** for posting, engagement, scraping, or DMs on any
  platform — it violates platform terms and reliably ends in a permanent ban. Where no API
  exists, the answer is **manual publish with an in-app checklist and copy-ready content**.
- **Securities firewall (§4.1).** Content must never carry securities account numbers,
  order details, suitability determinations, or individualized product/investment/replacement
  recommendations.
- **No collision with in-flight work.** The Native Communications Platform owns `lib/comms/`
  and `/app/comms/`. Social is a **separate channel with a separate publishing path** — it
  does **not** route through `send.ts`/`dispatcher.ts` (SMS/email). Where social and comms
  meet, they integrate through **CRM entities** (contacts, households, opportunities, tasks,
  activities), never by editing comms code.
- **Aggregate root (ADR-001).** Social leads resolve to **existing contacts and households** —
  never a parallel person record.

## Decision

Build a new module `social` inside FSOS, reusing existing auth, RLS, audit, background-job,
AI-workforce, CRM-service, and design-system infrastructure. Specifically:

1. **Adapter architecture with capability discovery.** Define a single `SocialPublisher`
   interface. Every platform implements it. The interface exposes **capability discovery**
   (`can post` / `can read engagement` / `can read analytics`), **publish**, and **error
   normalization** (platform errors normalize to a common shape). Platforms are added behind
   this interface as access is obtained.

2. **Configured-but-inactive adapters.** An adapter without valid credentials returns a
   deterministic **`not_configured`** state — it never crashes and never calls a live API.
   Ship YouTube and Facebook Page as the first working adapters; every other platform exists
   as a configured-but-inactive adapter reporting `not_configured`.

3. **Immutable approved versions + approval enforcement.** Content is versioned; approving
   **freezes** a version snapshot (immutable); any edit creates a new version. **Only an
   `APPROVED` version may be scheduled or published** — enforced in the service layer *and*
   as a DB-level guard, not merely in the UI. Approval, approver, and timestamp are retained
   on every published post. The AI can draft but can never approve or publish.

4. **Idempotent publishing on existing job infrastructure.** Scheduled publishing runs on the
   existing Vercel-cron/job path — never browser sessions or client timers. A scheduled item
   publishes **exactly once** (idempotency key), with bounded retry + backoff, a dead-letter
   terminal state on final failure, and an **immutable publish log** of every attempt and the
   normalized platform response.

5. **OAuth token security.** Platform OAuth tokens are **encrypted at rest, never sent to the
   browser, and never logged.** Token refresh is handled server-side; token expiry is surfaced
   in the UI as connection health. The content/schedule/publish tables store only a token
   *reference*, never token material.

6. **Engagement → CRM resolution.** Inbound engagement (comments, mentions, messages, where the
   API allows) resolves the author to an **existing contact** where possible via existing CRM
   services; unmatched authors go to a review queue. Tasks and opportunities are created through
   existing CRM services. A social DM that becomes a real conversation hands off to the CRM — it
   does **not** create a second inbox and **never** creates a duplicate person record.

7. **Analytics into existing dashboards.** Social metrics surface into the **existing**
   dashboards/reporting — no new dashboard system. Platform-reported metrics are distinguished
   from FSOS-attributed outcomes.

8. **AI workers extend the existing workforce.** Add social roles (start with a **Content
   Drafter** and an **Engagement Triager**) to the existing AI workforce, honoring the existing
   kill switch and policy gate. Social workers can never publish.

## Rationale

The adapter + capability-discovery + `not_configured` design is the only shape that survives
the platform-API reality: access is obtained incrementally and unevenly, so the module must ship
value on the platforms that work today while degrading cleanly on the rest. Immutable approved
versions + a DB-enforced approval gate make the FINRA pre-approval requirement a property of the
data model rather than a UI convention — it cannot be bypassed by a rogue call site. Reusing the
existing job, audit, AI-workforce, and CRM infrastructure honors §6 (no parallel subsystems) and
keeps social leads on the aggregate-root spine (ADR-001).

## Alternatives Considered

- **Route social through the comms dispatcher.** Rejected: comms is SMS/email with its own
  consent/quiet-hours/DNC gate and is mid-flight (slice 8/9). Social is a distinct channel with
  distinct platform semantics; sharing the path would couple two initiatives and break the
  prohibited-paths boundary.
- **Browser automation where APIs are missing.** Rejected outright — violates platform terms,
  is actively detected, and risks a permanent ban of the professional account. Manual-publish
  with a checklist is the supported fallback.
- **Let AI publish low-risk content directly.** Rejected — retail-communication rules require
  principal pre-approval; the AI never publishes.
- **A separate social analytics dashboard.** Rejected — §13.2/§6: metrics belong in the existing
  dashboards; a second dashboard fragments the product.
- **A parallel social-lead person record.** Rejected — ADR-001: leads resolve to contacts/
  households.

## Consequences

**Positive**
- Ships working value (YouTube, Facebook Page) while cleanly gating everything else.
- Approval and publish integrity are enforced in data, not just UI — auditable end to end.
- No new auth/permission/audit/job/dashboard subsystems; the comms boundary is preserved.
- Social leads stay on the aggregate-root spine; no duplicate CRM records.

**Negative / trade-offs**
- Manual-publish fallback means some platforms require FSA effort until API access lands.
- Per-platform adapters carry ongoing maintenance as platform APIs change.
- Configured-but-inactive adapters add surface area that must be tested for safe inertness.

## Related Documents
- CLAUDE.md §4.1 (securities firewall), §6 (architecture preservation), §10 (aggregate root),
  §11 (background jobs / AI governance), §13 (fintech quality), §16 (error handling)
- DESIGN.md (tokens, shells, Empty/Error/not_configured archetypes)
- docs/adr/ADR-001 (aggregate root), ADR-002 (AI gateway), ADR-007 (background jobs),
  ADR-008 (AI governance), ADR-015 (delegated communication authority), ADR-019 (AI authority),
  ADR-010 (data ownership & RLS)
- The build instruction: FSOS Social Content Module
