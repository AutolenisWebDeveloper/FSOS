# Design Audit — Executive Dashboard Redesign, Slice 1

**Scope:** presentation layer only. No data query, API route, business logic, schema, migration,
label, route, or destination was changed. `lib/comms`, GHL, the social module, and the AI workforce
logic were not touched.

**Branch:** `claude/fsos-dashboard-redesign-rvxc0k` · **Build:** `npm run build` green (exit 0).

---

## 1. What changed in this slice

### 1.1 Brand color → premium blue `#2C4C9C`, applied via tokens only
`src/app/globals.css` `:root`:

| Token | Before | After | Notes |
|---|---|---|---|
| `--primary` | `214 88% 40%` (`#0b5fcc`) | `223 56% 39%` (`#2C4C9C`) | New premium Farmers blue |
| `--primary-deep` | `215 90% 30%` | `223 56% 30%` | Pressed / gradient floor |
| `--primary-soft` | `213 92% 94%` | `223 60% 94%` | Soft wash / icon-chip backgrounds |
| `--ring` | `214 88% 42%` | `223 56% 42%` | Follows `--primary` |
| `--status-active` | `214 88% 42%` | `223 56% 42%` | Follows `--primary` |

No hex is hardcoded in the app UI — every brand surface (buttons, links, active nav, funnel bars,
KPI icon chips, focus rings, `.brand-fill` gradient, sparklines) resolves through these tokens, so
the change propagates to **all 51 pages** with no per-page edits. This *is* the shell/token
strengthening for Slice 1: the shared token layer is the single point of control, and it now
carries the new identity everywhere at once.

**Brand fidelity bonus:** the new `#2C4C9C` / `223 56% 39%` is *closer* to the official Farmers
Blue (`#1C428B` / `220 66% 33%`, DESIGN.md §5.2) than the old `#0b5fcc` / `214 88% 40%` was —
same hue neighborhood, less neon. The redesign reads more like the trademarked palette, not less.

### 1.2 `--accent` — A/B, not yet decided
`--accent` drives the one brighter "pop" (active-nav icon, rail active bar, active-tab underline,
link-hover glows, the "idle" agent dot). The brief asks to see the dashboard **both ways** before
deciding:

- **Option A (as-built):** `--accent: 209 92% 46%` — a cooler, higher-chroma cyan-blue. Reads as a
  deliberate secondary pop against `--primary`.
- **Option B (harmonized):** `--accent: 223 66% 52%` — same 223° hue as `--primary`, brighter and a
  touch more saturated. Reads more monochromatic / premium.

This slice **ships Option A unchanged** (non-destructive default) and delivers the side-by-side
comparison at `accent-ab-comparison.png` (and the harness `accent-ab.html`). Switching to Option B
is a **one-line token swap** once you decide. See §3 for the a11y comparison.

### 1.3 Orphaned hardcoded old-blue hexes — synced
Three surfaces render literal hex because they **cannot resolve CSS custom properties** (Satori
`ImageResponse` for icons/OG images; the root-error boundary renders its own `<html>`). All three
mirrored the *old* primary `#0b5fcc`; each is now synced to `#2C4C9C`, with a code comment noting
why the literal is required:

- `src/app/apple-icon.tsx`
- `src/app/opengraph-image.tsx`
- `src/app/global-error.tsx`

No other component or route hardcodes a brand-blue hex — the token discipline is otherwise clean
(verified by grep across `src/`).

### 1.4 DESIGN.md updated (governance §18)
`DESIGN.md §6.2` (Brand & accent tokens) updated to the new values + the recorded contrast ratios +
the accent A/B note. A token change must update `DESIGN.md` in the same change — done.

---

## 2. Design observations (current state vs the mockup)

The live Executive dashboard already implements most of the mockup's structure via
token-driven shared shells — this redesign strengthens that system rather than replacing it.

**Already present and on-token (keep):**
- AI Executive Briefing hero (`BriefingHero`) — indigo AI wash, Sparkles mark, 4 headline callouts,
  every figure a real signal.
- Needs Immediate Attention rail (`PriorityQueue`) — severity-tagged (High/Medium/Low), real signals.
- Business Performance KPI strip (`ExecutiveKpiStrip` → canonical `MetricCard`).
- Pipeline funnel (`PipelinePanel` → `FunnelChart`) — Referral→Review→Opportunity→Case→Issued.
- Launch Workspace grid, Activity Feed.
- Command bar, ⌘K palette, Daily Briefing, GDC-tier card in the sidebar footer.

**Gaps to close in Slice 2 (visual only, wired to existing data / `not_configured`):**
- **Business Health scorecard** — the mockup shows "78 / Good" with persistency/retention/etc. **No
  such data source exists.** Slice 2 renders it as the **`not_configured` archetype** ("metric not
  yet available"), never a hardcoded 78. (Previewed in the A/B harness.)
- **AI Recommendations panel** — Slice 2 reads the **existing** workforce (`/app/ai/workforce`,
  `agent_daily_targets`, `outreach_queue`); it invents no second agent system.
- Spacing rhythm / card elevation can be tightened to match the mockup's restraint (color = status:
  green good, gold attention, red risk, one blue primary).

**Consistency risks noted (not changed here):**
- `src/lib/forms.ts` transactional-email HTML uses literal `#2b6cb0` for its CTA button (email
  clients can't use tokens). Not in the brief's named hex list and governed by ADR-025 (immutable
  rendered email). **Flagged for a brand-consistency follow-up**, deliberately not touched in a
  presentation-only slice.

---

## 3. WCAG 2.2 AA verification

Computed with the WCAG relative-luminance formula (sRGB), white = `#FFFFFF`.

| Pair | Ratio | AA normal (4.5) | AA large / UI (3.0) |
|---|---|---|---|
| **white-on-`--primary`** (buttons) | **8.12:1** | ✅ (AAA) | ✅ |
| **`--primary`-on-white** (links / text) | **8.12:1** | ✅ (AAA) | ✅ |
| white-on-`--primary-deep` (pressed) | 10.83:1 | ✅ | ✅ |
| white-on-`--accent` **Option A** | 4.34:1 | ⚠️ 4.34 (just under 4.5) | ✅ |
| white-on-`--accent` **Option B** | 5.45:1 | ✅ | ✅ |

**Brief requirement met:** white-on-primary and primary-on-white both pass AA (in fact AAA) at
8.12:1.

**Accent footnote:** Option A as a *solid background with white normal-size text* is 4.34:1 — a
hair under AA-normal. In the codebase this is **not a real failure**: every `bg-accent` usage is a
low-opacity wash (`/30`, `/5`, `/40`) or a tiny status dot — there is **no** solid-accent + white
normal text anywhere. Option B (5.45:1) clears AA-normal outright, so choosing the harmonized accent
also removes the theoretical edge. This is a minor point in the A/B decision, not a blocker for
either option.

---

## 4. Verification performed

- `npm run build` — **green** (compiled + type-check + lint, exit 0) with the token changes.
- Grep sweep for hardcoded brand-blue hex across `src/` — only the three unavoidable literal
  surfaces (§1.3, now synced) plus the token definitions and email HTML (§2).
- Contrast math (§3) recomputed from the shipped HSL values.
- Accent A/B rendered and screenshotted at 2× for review (§1.2).

## 5. Not done in this slice (by design)

- Executive dashboard visual re-layout → **Slice 2**.
- Legacy inline-style screen migration → **Slice 3**.
- Responsive + a11y polish pass at 375/768/1440 → **Slice 4**.
- Applying the accent decision, and any approved nav-label change → after owner review.
