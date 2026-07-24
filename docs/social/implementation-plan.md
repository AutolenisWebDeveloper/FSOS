# FSOS Social Content Module — Implementation Plan

**ADR:** `docs/adr/ADR-026-social-content-module.md` (Accepted)
**Authority:** CLAUDE.md + /docs → DESIGN.md → accepted ADRs → live repo → skills → build instruction.
**Prohibited paths (never touched):** `lib/comms/`, `/app/comms/`. **No browser automation anywhere.**
**Migration head at plan time:** `060_fna_data_model.sql` → social starts at `061`.

## Reconciliation note (git workflow)

The build instruction describes per-slice feature branches merged to `main`. The binding
session constraint is: **develop on `claude/fsos-social-content-module-fik21d`, never push
elsewhere without permission.** Authority precedence (the session git requirement) wins.
Therefore all slices are developed on the single designated branch, committed per-slice with
clear messages, and surfaced through **one draft PR** for the branch. Each slice remains an
independently reviewable commit. This is called out so the divergence from the instruction's
per-slice-branch scheme is explicit, not silent.

## Slice map

| # | Slice | Deliverable | Migration |
|---|---|---|---|
| 1 | Data model + account connection | `social_*` tables, RLS, immutable version/log guards, `SocialPublisher` adapter interface + capability discovery + `not_configured`, channels service, `/app/social/accounts` | 061 |
| 2 | Content studio | AI drafting (existing gateway), human review/approve, immutable versioning, `/app/social/content*` | (uses 061) |
| 3 | Scheduling + YouTube | calendar/queue, timezone, conflict detection, idempotent cron publish path, YouTube adapter, `/app/social/calendar` + `/queue` + overview `/app/social` | 062 if needed |
| 4 | Facebook Page adapter | second adapter proving the abstraction | — |
| 5 | Engagement + CRM linkage | ingest comments/mentions/messages, resolve to existing contacts (no dup), tasks/opportunities via CRM services, `/app/social/engagement` | 063 if needed |
| 6 | Analytics + dashboard integration | metrics into existing dashboards, `/app/social/analytics`, nav placement decided here | — |
| 7 | Additional adapters | Instagram / LinkedIn Company / X — configured-but-inactive until access obtained | — |

## Slice 1 detail (this slice)

**Data model (migration 061, additive · idempotent · forward-only):**
- `social_channels` — platform, external account id, display name, connection status, `token_ref`
  (pointer only; never token material), encrypted secret column following the DOB precedent,
  scopes granted (jsonb), capability flags (`can_post` / `can_read_engagement` / `can_read_analytics`),
  connected_by/at, last_verified_at. Tokens never stored plaintext, never client-exposed.
- `social_content` — target platform(s), content type, body, media refs (jsonb), link, campaign/topic
  tag, author kind (human|ai), status, current_version pointer, soft-delete.
- `social_content_versions` — **immutable** frozen snapshots; approving freezes; edits create a new
  version. Content columns immutable via trigger; PUBLISHED version cannot be deleted.
- `social_approvals` — approver, timestamp, approved version, notes.
- `social_schedule_entries` — content version, target channel, scheduled_at, timezone, status.
- `social_publish_log` — **append-only** attempt/response/platform post id/published_at/failure reason.
- `social_engagement` — platform, post ref, type, author handle, content, received_at, resolved_contact.
- `social_analytics_snapshots` — platform metrics over time, capture ts, source.
- Status enum: `DRAFT → IN_REVIEW → APPROVED → SCHEDULED → PUBLISHING → PUBLISHED → FAILED → ARCHIVED`.
- RLS on every table (back-office read/write role lists per 010/060). Only APPROVED versions schedulable
  /publishable — enforced in service layer + a DB guard.

**Adapter interface (`src/lib/social/adapters/*`):**
- `SocialPublisher` — `capabilities()`, `publish()`, `normalizeError()`. Registry keyed by platform.
- Unconfigured platform → deterministic `not_configured` (never a live call, never a crash).

**Service + UI:**
- `src/lib/social/channels.ts` (service), Zod schemas in `src/lib/social/schema.ts`.
- `/app/social/accounts` server-component page: connected accounts, capabilities, connection health,
  Empty / Error / `not_configured` states, DESIGN.md tokens only, WCAG 2.2 AA.

**Tests (Slice 1):** adapter capability-discovery + `not_configured` inertness; approval-gate
(unapproved cannot schedule/publish); version immutability; RLS proof for new tables; token never
serialized to any client-facing shape; securities-firewall content guard scaffold.
