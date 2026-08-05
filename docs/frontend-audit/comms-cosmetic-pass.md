# AI Communications Center — review + cosmetic pass

**Scope:** frontend only. No schema, RLS, gate, dispatcher, or send-path change. No
route changes. Backwards compatible — every existing URL, prop signature and archetype
API is unchanged.

---

## 1. Backend review — no action required

Traced before touching anything, because a "communications cleanup" that quietly forks
the send path would be far worse than any styling defect.

| Check | Finding |
|---|---|
| Single outbound pipeline | ✅ `sendThroughGate` is the sole outbound path — 24 call sites, no alternates. |
| Provider isolation | ✅ `twilio.ts` / `resend.ts` are imported **only** by the four inbound + status webhooks. No page or API route reaches a provider directly. |
| Gate enforcement | ✅ `evaluateGate` is a pure decision core; `dispatcher`, `send`, and both simulation modules are its only consumers. |
| Parallel send paths | ✅ None found. |

**The communications backend is architecturally sound.** Every defect below is in the
presentation layer, which is where this pass stayed.

---

## 2. Defect register

| # | Severity | Defect | Evidence |
|---|---|---|---|
| C1 | **Critical** | `failed` / `bounced` fell through to the amber `pending` chip on `/comms/sms` and `/comms/email`, so a hard bounce read to the FSA as *still in flight*. `/comms/delivery` rendered the same row as `lost`. | 7 call sites hand-mapped `delivery_status` inline and disagreed. |
| C2 | **Critical** | The gate's two tiers were flattened into one chip. `gate.ts` distinguishes 4 **non-escalating deferrals** (`sms_live`, `business_hours`, `frequency`, `collision`) from 11 **escalating compliance blocks**. The UI showed both identically. | An advisor could not tell "retries in an hour" from "this is a TCPA stop." |
| C3 | **Critical** | Timestamps rendered with `toLocaleString('en-US')` inside **Server Components** → resolved against the server clock (UTC on Vercel), not the advisor's. | 12 comms surfaces. On a quiet-hours log, the recipient's local time *is* the compliance question. |
| H1 | High | Raw enum leakage into advisor-facing cells: `blocked: quiet_hours`. | `/comms` overview gate column. |
| H2 | High | Double border on every data table. `ui/table.tsx` already renders `rounded-xl border bg-card shadow-elev-xs`; pages wrapped it *again* in `rounded-lg border`. With `--radius: 0.625rem` the inner radius (14px) exceeds the outer (10px) → two hairlines with mismatched corners. | **87 sites app-wide**, 14 in comms. |
| H3 | High | `/comms` declared a **local** `StatTile` (a flat bordered div) while importing from the archetypes barrel that exports the canonical `StatTile`/`MetricCard` — icon chip, hover lift, affordance arrow, tone system. The hub of the comms workspace rendered visibly cheaper tiles than the rest of FSOS. | `comms/page.tsx`. |
| H4 | High | `CommsSubnav` rendered all 21 destinations at once; below `lg` it collapsed to `flex-col` — a 21-item vertical wall pushing page content below the fold on every comms route. | `CommsSubnav.tsx`. |
| M1 | Medium | `/comms/sms` and `/comms/email` were the same 42-line file apart from a channel filter and three strings. Neither selected `consent_at_send`, so their gate column could not have rendered a consent result. | Duplication rule violation. |
| M2 | Medium | Four surfaces hand-rolled segmented controls from bare `<button>`: no `type="button"` (submits inside a form), `role="tablist"`/`"tab"` with no `aria-controls`, no `tabpanel`, no roving tabindex. | WCAG 2.1 AA / ARIA APG. |
| M3 | Medium | `/comms` hand-rolled a `countOf` wrapper duplicating `loadCount` from `lib/data/query`. | Duplication rule violation. |
| M4 | Medium | `/comms/delivery` fetched up to 5,000 `delivery_status` rows and counted them in JS to produce four integers — and was silently wrong past 5,000 rows. | Performance + correctness. |
| L1 | Low | Tables had no caption; no `scope` on column headers. | a11y. |

---

## 3. Changes shipped

### New shared modules (all reuse existing tokens; nothing invented)

| Module | Purpose | Fixes |
|---|---|---|
| `lib/comms/message-status.ts` | **Pure** vocabulary: `deliveryStatus`, `gateOutcome`, `needsAttention`. Deferrals read amber, compliance blocks red, both in advisor language. Typed `satisfies Partial<Record<GateStep, true>>` so adding a gate step without classifying it is a **compile error**. | C1, C2, H1 |
| `lib/comms/message-log.ts` | One query shape for every message-log view. | M1 |
| `lib/comms/subnav.ts` | Pure, testable subnav config + active-state resolution. Mirrors the `lib/social/subnav` precedent. | H4 |
| `ui/time.tsx` | `<TimeCell>` — real `<time dateTime>`, deterministic SSR then upgraded to the viewer's timezone; full precision + zone in `title`. | C3 |
| `ui/segmented.tsx` | Accessible segmented control. `choice` (radiogroup) and `tabs` semantics, roving tabindex, arrow keys, Home/End, `type="button"`. | M2 |
| `comms/MessageStatusBadge.tsx` | `DeliveryStatusBadge` + `GateOutcomeBadge`. Server-Component-safe. | C1, C2 |
| `comms/MessageLogTable.tsx` | The single message log. Uses the design-system `TableCaption srOnly`, `scope="col"`, and an inset hairline (not a filled row) to mark exceptions. | M1, H2, L1 |

### Refactors

| Surface | Change |
|---|---|
| `/comms` | Local `StatTile` deleted → canonical `StatTile` with icons and tone. Ten flat tiles rebanded into **Needs attention · In flight · Gate activity**, so "delegation exceptions" no longer sits at the same weight as "sent today". `countOf` → `loadCount`. Attention tones only fire when the number is non-zero, so a clean board stays calm. |
| `/comms/sms`, `/comms/email` | 42 lines → ~30 each, sharing `MessageLogTable`. Channel column dropped (every row is that channel). |
| `/comms/delivery` | 5,000-row JS tally → exact head-only counts (no rows transferred). Rebanded into *Delivery state* / *Exceptions*. |
| `CommsSubnav` | Two tiers: sections always visible, current section's destinations below. Fixed two lines at every width via horizontal rails. Everything reachable in ≤2 clicks. **No route changes.** |
| `console-workbench` | Two hand-rolled controls → `Segmented`. Asset picker gained `type="button"`, `aria-pressed`, and a focus ring. |
| 8 comms pages | Redundant table wrapper removed (10 instances). |

---

## 4. Verification

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | ✅ clean |
| `npx next lint --dir src` | ✅ no warnings or errors |
| `tests/comms-message-status.test.mjs` (new) | ✅ 17 assertions |
| `tests/comms-subnav.test.mjs` (new) | ✅ 16 assertions |
| `tests/comms-console`, `comms-a2p-gate`, `comms-conversation` | ✅ 27 assertions, unchanged |
| `npx next build` | ⚠️ **Not verified in this environment** — fails only on `fonts.googleapis.com` fetches (`DM Sans`, `DM Mono`, `Inter`, `Poppins`), which is outside the sandbox network allowlist. No webpack or type errors. **Re-run on a networked machine before merge.** |

The two new suites are picked up automatically by `scripts/run-tests.mjs` — no
`package.json` edit needed.

### What the new tests lock down

- `failed` / `bounced` can never again render as the in-flight chip (C1 regression).
- Every `GateStep` in `gate.ts` is parsed **out of the source** and asserted to have an
  advisor-facing label — a new step without one fails the test rather than shipping a
  raw enum.
- `quiet_hours` (TCPA floor) stays a **block**; `business_hours` (operator preference)
  stays a **deferral**.
- An unrecognized block step fails safe to *blocked*, never *sent*.
- Every comms route on disk is reachable from the subnav (walks the real route tree, so
  a new surface fails here rather than shipping orphaned).
- `campaigns/new` still resolves to the Campaigns *group* even though it is excluded
  from the campaigns *list* active state — otherwise creating a campaign would drop the
  entire second nav tier.

---

## 5. Not done — recommended follow-ups

1. **H2 at scale.** 87 sites app-wide carry the double-bordered table wrapper; 10 were
   fixed here (comms only). The remaining ~77 are a mechanical pass — the codemod used
   is deterministic and matches only the exact shape.
2. **C3 at scale.** `TimeCell` exists now; ~40 non-comms surfaces still render
   server-side locale timestamps in the wrong timezone. Same fix, wider blast radius.
3. **M2 at scale.** `compliance/consent`, `forms`, and `archetypes/contact/notes` still
   hand-roll tablists and should adopt `Segmented`.
4. **`/comms/analytics`** still pulls 10,000 rows to compute four counts (same shape as
   M4). Left alone this pass because it needed a data decision, not a cosmetic one.
5. **Visual QA.** None of this was verified in a browser — no dev server in this
   environment. The dark-mode and reduced-motion behaviour of `Segmented` and the new
   tile bands should be eyeballed before merge.

---

## 6. Post-review corrections (investigation pass)

The patch above was re-verified end-to-end against the live repo. Every defect claim in
§2 was confirmed against source. `npx next build` — the one gate §4 could not run — now
passes (exit 0, full route table). Three issues found in review and fixed:

| # | Issue | Fix |
|---|---|---|
| R1 | `complained` and `received` were absent from the `DELIVERY` map, so they fell through to the neutral "unrecognized" chip. A **spam complaint rendered gray** — quieter than a bounce, and `needsAttention()` did not flag it. This is the same defect class as C1, surviving in the fix for C1. | Both given explicit presentations; `complained` reads `lost` and is an attention row. |
| R2 | `message-status.ts` claimed to be the single source of truth, but `lib/comms/timeline.ts:statusBadge` already presented `delivery_status` for the timeline surfaces — and they disagreed: `sent` was green here, amber there. | `sent` aligned to amber (provider-*accepted*, not *confirmed* — the incumbent reading, and the honest one). Both files cross-reference each other. |
| R3 | Two new design-system primitives (`ui/segmented.tsx`, `ui/time.tsx`) shipped without a `DESIGN.md` entry — CLAUDE.md §18 requires it in the same change. | `DESIGN.md` §7 documents both with usage rules; §9 gains the no-double-wrapper / caption+scope / exception-hairline table rules; §30 carries the four at-scale debts from §5. |

Two new guardrail tests prevent R1 and R2 recurring:

- **Schema coverage** — parses the `delivery_status` CHECK out of migration `033` and asserts
  every permitted value has an explicit presentation. A migration that widens the constraint
  fails here instead of shipping a status that renders as the neutral chip.
- **Timeline parity** — compiles `message-status.ts` and `timeline.ts` together and asserts no
  status is a success chip in one surface and a failure chip in the other. Verified
  non-vacuous (flipping `complained` back to neutral fails it).

`message-status` is now 20 assertions. Suite total: **149 test files, all passing.**

### Still open

Item 5 of §5 stands unchanged: **none of this has been verified in a browser.** Dark-mode and
reduced-motion behaviour of `Segmented`, and the `TimeCell` UTC→local flip on first paint,
should be eyeballed before this reaches production.
