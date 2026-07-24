# Native Communications Platform — Slice 9B: Hybrid Email Rendering

> Part B of Slice 9. Authoritative rationale: **ADR-025**. Separate PR from the nav work (9A).
> Establishes the rendering **mechanism** end-to-end with 3 exemplar templates; the remaining
> ~27 templates are mechanical follow-ups (add a component to the registry + `templates:build`).
> GHL untouched (§0.A).

## What shipped

| Concern | Delivery |
|---|---|
| **Author-time React templates** | `src/emails/`: `_layout` + 3 exemplars (annual-review, term-conversion-window, coverage-gap) + `registry`. `@react-email/*` are **devDependencies** — imported only by the generation script + test, never by app runtime. |
| **Deterministic render + hash** | `src/emails/render.ts` `renderEmailTemplate` → `{ html, text, sha }` (`sha256(html + ' ' + text)`). The send path never renders React — it dispatches stored bytes. |
| **Determinism test (byte-identical)** | `tests/email-determinism.test.mjs` bundles the registry with esbuild (installed, no network) and asserts each template renders **byte-identical** HTML + plaintext across runs, that `render_sha` pins those bytes, and green-zone invariants (tokens present, no baked-in opt-out footer, non-empty plaintext). |
| **Stored, immutable, versioned** | migration 061: `comm_templates.body_text` (plaintext, part of the approved artifact) + `render_sha` (pins bytes) + `source_key`. |
| **Generation (immutable-approval preserved)** | `scripts/build-email-templates.ts` (`npm run templates:build`) renders each component → upserts a DRAFT template. Same `render_sha` → no-op; changed bytes → bump `version` + reset to draft (approval cleared) → re-approval; new `source_key` → v1 draft. |
| **Multipart send** | `sendThroughGate` gains `ctx.bodyText`; the dispatcher threads it to `sendEmail`'s existing `text` param (email only). Plaintext is personalized + identity-prepended like the HTML, but not tracking-instrumented. Absent → single-part (existing behavior). The campaign broadcast path supplies it from the stored `body_text`. |

## The immutable-approval + determinism contract

The send path dispatches the **stored** HTML + plaintext, so a dependency bump can never silently change
what sends. Re-rendering with changed bytes changes `render_sha` → a new draft `version` that a licensed
reviewer must approve. The determinism test guarantees the render is reproducible in the first place, so
"approved" always means "these exact bytes were reviewed."

## Scope boundary

- 3 exemplar templates prove the mechanism; the remaining ~27 land as follow-up PRs using the same
  registry + `templates:build` flow.
- Existing string templates keep working unchanged (`body_text` null → single-part send).
- react-email audit advisories are **dev/author-time only** (never in the runtime bundle) — no runtime
  exposure; a breaking `audit fix --force` was intentionally not applied.

## Evidence

- `tests/email-determinism.test.mjs` — 9 assertions across 3 templates (byte-identical render, sha pins
  bytes, green-zone invariants).
- `tests/rls-firewall.test.mjs` — applies migration 061 (real Postgres).
- `npm test` (+`email-determinism`) · `type-check` · `lint` · `test:rls` · `build` — all green.

## Guardrails touched

Every template body is green-zone + recommendation-free (build-gated). The plaintext part is stored +
immutable (never generated at send). The dispatcher still appends the TRAIGA footer at send (§12); no
opt-out footer is baked into templates (asserted). Securities firewall + AI red-line unchanged. GHL
frozen (§0.A).
