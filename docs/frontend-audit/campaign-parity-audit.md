# Campaign Engines — three-module parity audit

**Modules:** Life Conversion (`/app/comms/life-conversion`) · Cross-Sell Life
(`/app/comms/cross-sell-life`) · Pipeline Win-Back (`/app/comms/pipeline-winback`)

**Method:** static audit of the repository. The three live URLs are behind authentication,
so nothing here is based on the rendered site — every finding cites a file. No runtime or
visual QA was possible in the environment that produced the original audit (see §6).

---

## 0. Reconciliation — what was verified against this tree

The audit was authored against a working copy that **is not this repository's `main`**. It
describes a concurrent session's unification layer (`src/lib/comms/campaign-presentation.ts`,
`src/components/comms/campaign/CampaignKit.tsx`, `tests/comms-campaign-presentation.test.mjs`)
as already present, and reports a broken build caused by that refactor. Neither was true here:
that work never merged, so `main` still carried the original per-page forks and compiled clean.

Every finding below was re-verified against the tree at the start of this work. Status:

| Audit finding | Verified against this tree |
|---|---|
| §1 build broken by TS2304 in `cross-sell-life/[id]` | **Did not apply.** The refactor that caused it was never merged; `tsc --noEmit`, `next lint`, and 149 test files were clean at baseline. |
| §1 the false-green test pattern | **Real and important.** The named test did not exist here, so the pattern was fixed *before* it could ship — see `tests/comms-campaign-presentation.test.mjs`. |
| §2.1 Win-Back has no `list → [id]` split | **Confirmed.** Single 440-line page rendering `DetailShell` on a list route. |
| §2.2 library modules diverge | **Confirmed.** |
| §2.3 API surface: 4 / 14 / 4 routes | **Confirmed** by file count. |
| §2.4 only Cross-Sell has an `-enroll` cron | **Confirmed.** Out of scope — business decision (§5.6). |
| §2.5 three analytics shapes behind one function name | **Confirmed.** |
| §2.6 no two pages order sections the same way | **Confirmed.** |
| §2.7 the Life module carries four names | **Confirmed.** Out of scope — touches routes (§5.8). |
| §4 `cross-sell-life/[id]` formats dates server-side | **Confirmed, plus one the audit missed:** `life-conversion/[id]` did the same. Both now use `TimeCell`. |
| §6 seeded touch counts (20 / 35 / 24) unverified | **Now verified** against each engine's `schedule.ts`, and pinned by a test so the registry cannot drift. |

Treat the matrix below as the defect register it was written to be, read through the table above.

---

## 1. The false-green test pattern

The audit's most transferable finding, and the reason it leads this document.

A test that asserts "the forked map is gone" by grepping each page for the **absence** of a
declaration gets *greener* as the tree gets more broken:

```
deleting `const KIND_TONE = …` while leaving `KIND_TONE[t.kind]` at the call site
  → the grep assertion PASSES (the declaration really is absent)
  → the page no longer compiles (TS2304: Cannot find name 'KIND_TONE')
  → `next build` fails
```

**Rule: any test asserting that a fork was removed must also compile the consuming module.**

`tests/comms-campaign-presentation.test.mjs` implements this. Its fork-removal, timestamp,
and palette-color assertions are each paired with a real `tsc` pass over all five campaign
pages, and a dedicated regression case applies the historical mutation (strip the shared
import, keep the call sites) to a throwaway copy and asserts the type-check **fails** on it —
proving the guard fires on exactly the defect that shipped, rather than merely existing.

### Audit of the same pattern elsewhere

Grep-for-absence assertions also appear in `tests/operational-email.test.mjs` and
`tests/transactional-notifications.test.mjs` (`no direct Resend instantiation remains`,
`does not read consents for a transactional send`). These are a **lower-risk variant**: they
assert a call is absent rather than a *declaration*, so the analogous mutation leaves no
dangling identifier and no compile error to catch. They were left as-is deliberately. Any new
declaration-removal assertion must follow the compile-guard pattern above.

---

## 2. Parity matrix

### 2.1 Routes and shells

| | Life Conversion | Cross-Sell Life | Win-Back |
|---|---|---|---|
| List page | ✅ `ListShell` | ✅ `ListShell` | ❌ **none** |
| Detail page | ✅ `[id]` | ✅ `[id]` | ❌ **none** |
| Structure | list → detail | list → detail | **single page** |
| Shell used | `ListShell` | `ListShell` | `DetailShell` |

**Win-Back is architecturally the odd one out.** `src/lib/pipeline-winback/detail.ts` exports
`loadCampaignDetail` — a fully built detail loader — consumed by the *list* route because no
`[id]/page.tsx` was ever created. This is the single largest structural inconsistency and
drives most of the UX divergence.

### 2.2 Library modules

| Module | Life | Cross-Sell | Win-Back |
|---|:--:|:--:|:--:|
| `analytics` `controls` `conversation` `data` `detail` `eligibility` `enroll` `jobs` `schedule` `tick` | ✅ | ✅ | ✅ |
| `advisor` | ✅ | ✅ | ❌ |
| `inbound` | ✅ | ✅ | ❌ |
| `states` | ✅ | ✅ | ❌ (`engine.ts` instead) |
| `playbooks` | ❌ | ✅ | ✅ |
| `resume` | ✅ | ❌ | ❌ |
| `retry` | ✅ | ❌ | ❌ |
| `advisor-scripts` `control-contract` `ownership-core` | ❌ | ✅ | ❌ |

### 2.3 API surface — the widest gap

| | Life | Cross-Sell | Win-Back |
|---|:--:|:--:|:--:|
| Routes | **4** | **14** | **4** |

Cross-Sell Life alone exposes `[id]` · `[id]/enrollments` · `[id]/settings` · `[id]/version` ·
`conversation` · `eligibility` · `exit` · `preview` · `enrollments/[id]/action` ·
`enrollments/[id]/advisor-ownership`. Consequences for the other two: no per-enrollment
actions, no settings write path, no preview, no eligibility endpoint, no versioning.

### 2.4 Automation

| | Life | Cross-Sell | Win-Back |
|---|:--:|:--:|:--:|
| `-tick` cron | ✅ 15:00 | ✅ 16:00 | ✅ 15:00 |
| `-retry` cron | ✅ hourly | ✅ hourly | ✅ hourly |
| **`-enroll` cron** | ❌ | ✅ 13:00 | ❌ |

**Only Cross-Sell Life enrolls automatically.** ⚠️ Adding the other two changes *who gets
contacted* — a business decision, not a code change. Flagged, not shipped.

### 2.5 Analytics contract

Three incompatible shapes behind one function name (`campaignAnalytics`): `CampaignAnalytics`
(life, flat counts + `byPhase`), `CampaignAnalytics` (cross-sell, nested `totals` + `funnel` +
`rates` + `channels` + `version`), `WinbackAnalytics` (flat counts + `byPhase` + `byCategory` +
`eligibleNow`). Nothing can be shared until this is one superset with optional engine-specific
blocks.

### 2.6 Page composition

No two pages ordered their sections the same way; three sections existed on only one page each;
`CampaignCrossLinks` existed on Win-Back only, so Life Conversion and Cross-Sell Life were dead
ends with no path to their siblings.

### 2.7 Naming

`life-conversion` (route) → `life-campaign` (lib) → `/api/life-campaign` (API) →
`life_campaigns` (table) → `life_conversion` (engine key). Four names for one thing. ⚠️ Touches
routes and API paths; sequence last and behind redirects.

---

## 3. Duplication register

| What | Where |
|---|---|
| `STATUS_TONE` | 5 copies across the three modules |
| `KIND_LABEL` | 3 copies |
| `KIND_TONE` | 2 copies |
| `APPROVAL_TONE` | 1 copy — the other two modules went without, so an unapproved asset was invisible on two of three screens |
| The stat cell | **6 copies** — `PhaseCell`, `FunnelCell`, `MiniCell` (×2 divergent), `Cell` (×2). All inverted the design-system order; one tinted attention with `border-amber-400/60`, a raw palette color |
| `Section` | Redefined **locally** in two detail pages, shadowing the design-system `Section` |
| Enrollment table markup | 3 near-identical copies |
| "Operational controls" block | 3 copies differing only in prose |
| `campaignAnalytics` | 3 implementations, 3 return shapes, 1 name |
| `crumb()` | 3 copies |
| Header actions | 3 copies of `<Link>` hand-styled as a button, missing the button system's focus ring |

---

## 4. Sequence

1. ~~Fix the false-green test pattern.~~ **Done** — §1.
2. ~~Land the shared presentation layer and de-fork all three pages.~~ **Done.**
3. Give Win-Back a `list → [id]` split.
4. Unify the analytics contract into one superset.
5. Extract the shared components.
6. One canonical section order; `CampaignCrossLinks` everywhere.
7. ⚠️ Close the automation gap — **business decision.**
8. ⚠️ API parity — decide per endpoint; versioning may be genuinely Cross-Sell-only.
9. ⚠️ Rename the Life module — touches routes; behind redirects.

---

## 5. What this audit did *not* cover

Stated plainly so the gaps aren't mistaken for clean results:

- **No visual, responsive, or dark-mode QA.** Every layout finding is from reading JSX, not
  from a rendered page. Breakpoint behaviour, animation, and contrast are unverified.
- **No accessibility testing.** No axe run, no keyboard walkthrough, no screen-reader pass.
- **No database review** beyond confirming each engine's seed migration exists and that the
  registry's touch counts match `schedule.ts`.
- **No end-to-end QA** of enrollment, AI conversation, or send flows — that requires a running
  app against a seeded database.

The original request asked for a complete end-to-end QA review. That cannot be done
statically, and this document should not be read as one.
