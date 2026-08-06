# Campaign engines — unification pass report

**Scope:** Life Conversion · Cross-Sell Life · Pipeline Win-Back
**Companion:** `docs/frontend-audit/campaign-parity-audit.md` (the defect register this worked from)

Per-phase: what was found, what changed, what could not be verified, and what was deliberately
left alone.

---

## Phase 0 — the brief's premise did not match the branch

The task described a partial unification as already present (`src/lib/comms/campaign-presentation.ts`,
`src/components/comms/campaign/CampaignKit.tsx`, `tests/comms-campaign-presentation.test.mjs`) and
instructed: *extend these, do not create a parallel layer.*

**None of those files existed on `main`.** They were written in a sandbox working copy that never
merged. The audit's §0 recorded them as present because it ran against that copy.

Two findings that followed from the brief were therefore inapplicable:

- **The reported build break did not exist.** The `TS2304` errors came from the unmerged refactor.
  Baseline was clean: `type-check`, `lint`, and 149 test files all passed.
- **The false-green test could not be "rewritten"** — it did not exist. It was written correctly
  from the start instead.

The layer was built rather than extended. Same destination, one phase earlier than assumed.

---

## Phase 1 — the shared presentation layer

**Found.** Eleven forked declarations of the same vocabulary: `STATUS_TONE` ×5, `KIND_LABEL` ×3,
`KIND_TONE` ×2, and an `APPROVAL_TONE` that only Win-Back had — so an unapproved template was
invisible on two of three screens. Every copy mapped campaign state onto the *generic* badge
variants instead of the FSOS status tokens, so an Active campaign rendered as a solid primary chip
indistinguishable from any other `default` badge.

**Changed.** `campaign-presentation.ts` (pure vocabulary + the `CAMPAIGN_ENGINES` registry) and
`CampaignKit.tsx` (badges, one stat cell, real `Button` header actions, cross-links). All five
campaign pages adopted both. Removed: 11 forked maps, 6 divergent stat cells (one using
`border-amber-400/60`, a raw palette color), 3 `crumb()` copies, 3 hand-styled `<Link>`-as-button
clusters missing the button system's focus ring.

**The testing decision that mattered.** A "the fork is gone" test that greps for a missing
declaration is **false-green**: delete the declaration, leave the call sites, and the assertion
passes while the page stops compiling. Every fork-removal assertion here is paired with a real
`tsc` pass over all six campaign pages, and one case applies that exact mutation to a throwaway
copy and asserts the type-check *fails* on it.

**Defects surfaced by the work, not by the audit:**
- `life-conversion/[id]` formatted timestamps with `toLocaleDateString()` in a Server Component —
  the same UTC-vs-advisor-local defect the audit found in `cross-sell-life/[id]`, on a page it did
  not flag. Caught by the new test *after* the known one was fixed.
- Win-Back's schedule rendered "missing" for every advisor-outreach touch, which correctly has no
  template — crying wolf on 5 of 24 rows.

**Now verified** (the audit listed it as uncovered): seeded touch counts and day spans — 20/180,
35/180, 24/120 — match each engine's `schedule.ts`. A test pins the registry to them.

---

## Phase 2 — structural parity

**Found.** Win-Back had no `list → [id]` split: one 440-line route rendered a `DetailShell` where a
list belongs and served the detail from the list URL, though `loadCampaignDetail` was already
written. Three engines returned three analytics shapes behind one function name. No two pages
ordered their sections the same way. `CampaignCrossLinks` existed on Win-Back only.

**Changed.**
- Win-Back split into list + `[id]`, with the correct skeleton on each. **No route changed**, so no
  redirect was needed — `/app/comms/pipeline-winback` still resolves, now to a list.
- One `CampaignAnalytics` superset: a universal core plus optional blocks an engine fills only if it
  measures that thing. Optional blocks are **absent, not zeroed**, so a shared component tests for
  presence rather than rendering a row of zeroes.
- Five components extracted, each replacing 2–3 near-copies. Two more local `Section` definitions
  that shadowed the design-system one are gone.
- One canonical section order; cross-links on all three.

**A reconciliation bug this exposed.** Life Conversion and Win-Back headlined
`enrollments['active']` — the narrow bucket — while computing `byPhase` over the broad set. The KPI
tile read "Active enrollments 12" directly above a phase distribution summing to 15, on the same
screen, with nothing indicating which was right. **See "Requires sign-off" below** — the fix
changes a number the FSA may be tracking.

**Three more defects surfaced by consolidating:**
- The unapproved-asset warning existed only on Win-Back, so an operator elsewhere could activate a
  campaign whose templates were all draft and see nothing explaining why it sent nothing.
- All three asset browsers badged approval as `approved | outline`, so a **rejected** template was
  visually identical to a draft one — on the screen whose entire job is showing what may be sent.
- Touch outcomes, including suppressed and dead-lettered sends, appeared on Win-Back only.

Also removed a redundant round trip in `life-campaign/analytics.ts` and parallelised the rest.

---

## Phase 3 — design

**The state line** (`campaign-state.ts` + `CampaignStateLine.tsx`). Every screen led with four or
five equal-weight KPI tiles; equal weight is no hierarchy. The facts determining whether a campaign
works were scattered across four sections, so a campaign could read "Active" while every template
sat in draft and nothing connected those facts. The line states the answer in one sentence, then
lists blockers with a link to each fix. A **blocker outranks lifecycle status** — a live campaign
that cannot dispatch must not read as calmly running. Suppressed sends are a **note, never a
blocker**: that is the gate working correctly, and it stays visible because a blocked send must
never be silently dropped.

**Corrections to Phase 2's own output.** The extraction had re-introduced the double `Table` wrapper
(DESIGN.md §9 — inner radius exceeding outer, two mismatched hairlines) and dropped
`TableCaption srOnly` / complete `scope="col"`. Fixed at the shared-component layer, so all six
surfaces were corrected at once.

**Tightening.** Loading skeletons said "Life Conversion Campaign" while the pages said "Life
Conversion", so the heading visibly changed as the load completed — all six now derive the title
from the registry. Two `<summary>` disclosures had no focus ring. Every empty state now invites an
action (§17).

**Section-order drift I introduced, caught by the new test.** Cross-Sell bundled "Campaign overview"
into slot 8 alongside Configuration, so slot 8 meant different things on different engines.
Overview now has its own slot. An engine may omit a slot; it may never reorder or reuse one.

**Governance.** `DESIGN.md` §10.1 (campaign component family, AS-BUILT) and §10.2 (the operational
state line, STANDARD) were added, and §30's two carried-forward debt counts corrected. This was
**late** — CLAUDE.md §18 requires the DESIGN.md update *in the same change* that introduces a
pattern, and five commits shipped before it.

---

## Could not be verified

Stated plainly so the gaps are not mistaken for clean results.

- **No visual verification of anything.** No dev server, no screenshots, no responsive check, no
  dark-mode check. `supabase start` cannot run: container-registry egress is denied by policy
  (`ghcr.io` and the Docker/ECR mirrors all return 403). Docker itself works; the images cannot be
  fetched. Every layout and contrast statement in this pass is from reading JSX.
- **No keyboard walkthrough and no screen-reader pass.** The focus-ring and caption work is asserted
  in source, not observed. `tests/comms-campaign-surface.test.mjs` is a deliberate substitute for
  looking, and is weaker than looking.
- **No end-to-end QA** of enrollment, AI conversation, or send flows — needs a seeded database.
- **The "active" count change is unquantified** — see below.
- **The Vercel deployment failure is unexplained.** It began mid-pass and recurred on four
  structurally unrelated commits (a 2,900-line refactor, a test-only change, three deleted `<div>`s,
  one new component), each failing 3–7 seconds after push — too fast to have reached a build. CI's
  `verify` job runs the identical `npm run build` and passed on every one. No Vercel credential
  exists in this environment, so the logs could not be read. A lead worth checking: `Supabase
  Preview` was already failing on `main` before this branch existed, and if that integration injects
  the build-time Supabase env vars, an expired token would fail deployment during environment
  resolution — before install, independent of the diff, and invisible to CI. **Not proven causal:**
  `main` deployed successfully while that check was already failing.

---

## Requires sign-off — the "active" definition

`totals.active` now counts the broad in-flight set (including `paused_for_conversation` and
`paused_by_admin`) on all three engines, so the KPI tile and the phase distribution count the same
population. Previously Life Conversion and Win-Back headlined only the narrow bucket.

**The number on screen will jump upward after deploy**, by exactly the count of paused enrollments,
and anyone tracking it week to week will see a discontinuity with no explanation. The held subset is
surfaced separately as `totals.paused`, and the state line names it.

Whether "active" means the broad or narrow set is a **business definition**, settled here by an
engineering judgment call in service of internal consistency. It should be confirmed or reversed
deliberately. The before/after counts on seeded data are a single query once an environment exists;
they are not in this report because they could not be produced.

---

## Deliberately left alone

- **Auto-enrollment crons for Life Conversion and Win-Back.** Only Cross-Sell enrolls automatically.
  Adding them changes *who gets contacted* — a business decision, not a code change.
- **Campaign versioning beyond Cross-Sell.** Plausibly engine-specific.
- **The Life module's four names.** Proposed in `docs/adr/ADR-037-life-conversion-naming-unification.md`,
  not executed — it touches routes and API paths.
- **The campaign timeline ribbon.** Designed and agreed in principle, then gated on visual
  verification that never became possible. Shipping a band that reasons well and renders as an
  illegible smear at 375px is worse than shipping none.
- **The grep-for-absence assertions in `operational-email.test.mjs` and
  `transactional-notifications.test.mjs`.** Same family as the false-green pattern, but they assert
  a *call* is absent rather than a *declaration*, so the analogous mutation leaves no dangling
  identifier and no compile error to catch. Lower risk; left as-is.
- **`/comms/analytics` pulling 10,000 rows for four integers.** Pre-existing, outside this scope,
  still in DESIGN.md §30.

---

## Verification actually run

`npm run type-check` · `npm run lint` · `npm test` (153 files) · `npm run build` — all green.
The build and the RLS firewall proof ran in CI, which executes the identical commands.

**Note on CI as evidence:** CI and Vercel differ in injected environment variables and dependency
resolution, so "CI's build passed" does not by itself prove a Vercel deployment would. It proves the
code compiles and the tests pass. It is not a substitute for the visual verification above.
