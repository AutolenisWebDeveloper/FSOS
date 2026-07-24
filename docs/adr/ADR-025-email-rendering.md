# ADR-025 — Email Rendering: Hybrid React → Stored, Immutable, Deterministic HTML + Plaintext

**Status:** Accepted
**Date:** 2026-07-24
**Owner:** FSOS Engineering (approach ratified by the platform owner)
**Related:** ADR-003 (dispatcher), ADR-013 (canonical `comm_*`), ADR-023 (campaign library); CLAUDE.md §12; master build instruction Slice 9 Part B.

## Context

Slice 9 introduces ~30 campaign email templates. Email bodies today are HTML **strings** stored in `comm_templates.body`, personalized with `{{tokens}}`, instrumented with an open-tracking pixel, and sent via `sendEmail(to, subject, html, text?)` (the plaintext `text` slot existed but was unused). The approval model is **immutable-by-DB**: a licensed reviewer approves the exact stored `body` at a `version`; any edit bumps `version` and resets `approval_status` to draft. That "a reviewer approves the exact bytes that send" property is a compliance asset.

Hand-authoring 30 cross-client HTML strings is error-prone (Outlook, Gmail dark mode, mobile). But rendering React **at send time** would move the approved artifact from a reviewable DB row to code, relocating approval/versioning to git and **weakening** the regulated model. The owner chose the hybrid and set two hard requirements: (1) the plaintext is part of the approved artifact — **stored**, versioned, and immutable alongside the HTML, never generated at send time; (2) the render is **deterministic** (same component + versions → byte-identical output), with a test.

## Decision

**Author templates as React Email components; render them at BUILD/AUTHOR time to a stored HTML + plaintext pair that flows through the EXISTING immutable DB approval model. The send path never renders React.**

1. **Author-time only.** `@react-email/components` + `@react-email/render` are **devDependencies**. All email-authoring code lives under `src/emails/` (components, `_layout`, `registry`, `render.ts`) and is imported **only** by the generation script + the determinism test — never by app runtime, so React/react-email never enter the Next bundle or the send path.

2. **Deterministic render + a hash that pins the bytes.** `renderEmailTemplate(el)` → `{ html, text, sha }` where `sha = sha256(html + ' ' + text)`. `tests/email-determinism.test.mjs` bundles the registry with esbuild (installed, no network) and asserts every template renders **byte-identical** HTML + plaintext across runs and that the sha pins those exact bytes. A dependency bump that changes output changes the sha.

3. **Stored, immutable, versioned (migration 061).** `comm_templates` gains `body_text` (the plaintext part — part of the approved artifact), `render_sha` (pins the approved bytes), and `source_key` (the component it was rendered from). The generation script (`npm run templates:build`) renders each component and upserts a DRAFT template: a matching `render_sha` is a no-op (idempotent); changed bytes bump `version` + reset to draft (approval cleared) so the exact new bytes are re-reviewed; a new `source_key` inserts as v1 draft.

4. **Send path uses the stored bytes (multipart).** `sendThroughGate` gains `ctx.bodyText`; the dispatcher threads it to `sendEmail`'s `text` param (email only; SMS unaffected). The plaintext is personalized with the same tokens and carries the same identity-disclosure prepend as the HTML, but is **not** instrumented (open/click tracking is HTML-only). Absent `body_text` → single-part HTML, exactly as before.

## Rationale

- **Cross-client quality without weakening governance.** React Email gives tested cross-client HTML + a plaintext fallback; storing the rendered bytes keeps the approved artifact a reviewable DB row at a `version` — the reviewer still approves exact bytes.
- **Determinism makes "approved" meaningful.** Because the send path dispatches stored bytes (never a live render), a dependency bump can't silently change what sends; re-rendering changes the sha → new draft → re-approval. The determinism test guarantees the render is reproducible in the first place.
- **No runtime dependency creep.** react-email stays a devDependency; nothing in the runtime send path imports it.

## Alternatives Considered

- **Keep hand-written HTML strings** — rejected: no new deps, but cross-client rendering defects at 30-template scale.
- **Runtime React (render at send / pass `react` to Resend)** — rejected: moves the approved artifact to code, weakening the immutable DB approval + versioning model for a regulated flow.
- **Generate plaintext at send time** — rejected by the owner: the plaintext must be part of the approved, immutable artifact, so it is stored and versioned with the HTML.

## Consequences

**Positive**
- Cross-client HTML + a stored plaintext fallback; the reviewer approves exact, hash-pinned bytes; the render is provably deterministic.
- Existing string templates keep working unchanged (`body_text` null → single-part send).

**Negative / trade-offs**
- Templates are regenerated via an ops script (`templates:build`) rather than edited inline; changing a component requires re-render + re-approval (by design).
- react-email pulls dev-tree audit advisories; they are **dev/author-time only** (never in the runtime bundle), so there is no runtime exposure. `audit fix --force` (breaking) was intentionally not applied.

## Related Documents

- CLAUDE.md §12; master build instruction Slice 9 Part B
- ADR-003, ADR-013, ADR-023
- Migration `supabase/migrations/061_comm_template_render.sql`
- `src/emails/*` (components, `_layout`, `registry`, `render.ts`), `scripts/build-email-templates.ts`, `src/lib/comms/dispatcher.ts`, `send.ts`, `campaign.ts`
- Tests: `tests/email-determinism.test.mjs`, `tests/rls-firewall.test.mjs` (applies 061)
