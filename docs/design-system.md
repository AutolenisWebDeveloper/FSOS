# FSOS Design System

> **Why this file exists.** The original spec gave visual design six lines ("professional financial-services aesthetic, not a generic template"). That was insufficient, and the result was default light-mode shadcn — correct but characterless. This file replaces that placeholder with a real design spec.
>
> **The mandate:** FSOS must carry the character of the legacy Command Center — the dark navy shell, the mono uppercase labels, the density, the branded identity — while keeping the FSOS architecture (per-user auth, RLS, portals, audit). Same soul, better bones.
>
> **Supersedes** the "Design system" section at the bottom of `archetypes.md`.

---

## 1. Design direction

**Dark-first, dense, branded, financial-services.** Not airy SaaS. Not a generic admin panel. This is an operator's cockpit: information-dense, high-contrast, fast to scan, with a distinct identity.

The legacy Command Center already established this language. We are **carrying it forward**, not reinventing it.

**Three signature elements that define the look — do not lose these:**
1. **Dark navy shell** (`#0f1e36`) with a light content canvas.
2. **Uppercase mono section labels** (DM Mono, letter-spaced) — "NAVIGATION", "LIVE STATUS", "QUICK ACCESS", "FFS KEY CONTACTS". This is the strongest character marker.
3. **Branded identity block** — the "M / Markist / FSA COMMAND CENTER" lockup at the top of the sidebar.

---

## 2. Typography

Carried from legacy. Load via `next/font/google`.

| Role | Font | Usage |
|---|---|---|
| **Body / UI** | **DM Sans** | All prose, labels, table content, buttons |
| **Mono / labels** | **DM Mono** | Section labels, IDs, policy numbers, currency, timestamps, code, status chips |

**The mono label treatment (signature):**
```css
font-family: var(--font-dm-mono);
font-size: 0.6875rem;      /* 11px */
letter-spacing: 0.12em;
text-transform: uppercase;
color: hsl(var(--muted-foreground));
```
Use for: sidebar section headers, card eyebrow labels, dashboard tile captions, panel titles.

**Scale (DM Sans unless noted):**
| Token | Size / Line | Weight | Use |
|---|---|---|---|
| `display` | 30/36 | 600 | Page title on dashboards |
| `h1` | 24/32 | 600 | Page title |
| `h2` | 18/26 | 600 | Section heading |
| `h3` | 15/22 | 600 | Card title |
| `body` | 14/21 | 400 | Default |
| `small` | 13/18 | 400 | Secondary |
| `label` | 11/16 | 500 | **DM Mono**, uppercase, tracked — the signature |
| `numeric` | 14/20 | 500 | **DM Mono** — money, policy #, dates, IDs |

**Rule:** every monetary value, policy number, date, ID, and percentage renders in **DM Mono** with tabular figures (`font-variant-numeric: tabular-nums`). This is what makes a financial tool feel like a financial tool.

---

## 3. Color tokens

Carried from the legacy palette. Replace the current `globals.css` `:root` block.

```css
:root {
  /* ---- Shell (dark) ---- */
  --shell:            215 56% 13%;   /* #0f1e36 — sidebar / topbar */
  --shell-raised:     217 32% 15%;   /* #1a2332 — panels inside shell */
  --shell-foreground: 210 20% 96%;
  --shell-muted:      215 16% 62%;
  --shell-border:     215 30% 22%;

  /* ---- Content canvas (light) ---- */
  --background:       210 20% 98%;
  --foreground:       215 40% 12%;
  --card:             0 0% 100%;
  --card-foreground:  215 40% 12%;
  --muted:            214 32% 95%;
  --muted-foreground: 215 16% 42%;
  --border:           214 20% 88%;
  --input:            214 20% 86%;

  /* ---- Brand ---- */
  --primary:            212 61% 43%;   /* #2b6cb0 — legacy primary */
  --primary-foreground: 0 0% 100%;
  --primary-soft:       205 74% 86%;   /* #bee3f8 */
  --accent:             207 73% 57%;   /* #4299e1 */
  --accent-foreground:  0 0% 100%;

  /* ---- Signature gold (GDC tier, assumptions, attention) ---- */
  --gold:            43 89% 51%;       /* #f0b429 */
  --gold-deep:       38 72% 42%;       /* #b7791f */
  --gold-foreground: 215 40% 12%;

  /* ---- Status ---- */
  --status-draft:      215 16% 55%;
  --status-active:     212 61% 45%;
  --status-pending:    38 92% 45%;
  --status-won:        142 50% 40%;    /* #38a169 */
  --status-lost:       0 72% 51%;      /* #e53e3e */
  --status-blocked:    0 72% 42%;
  --status-escalated:  262 47% 42%;    /* #553c9a */
  --status-assumption: 38 72% 42%;     /* gold — "config default — verify" */
  --status-security:   262 47% 42%;    /* purple — is_security / FFS-managed */

  --radius: 0.5rem;
}
```

**Semantic rules:**
- **Gold** = attention + assumption. Every `is_assumption` badge is gold. The GDC tier card is gold. Never use gold for success.
- **Purple** = securities / FFS-managed / escalated. If a row is `is_security`, it carries a purple marker and an "FFS-managed" chip. This makes the firewall *visible*.
- **Green** = won/placed/active only.
- **Red** = lost/blocked/error only.

---

## 4. Layout & density

- **Grid:** 12-col, 24px gutters. Content max-width 1400px.
- **Spacing scale:** 4 / 8 / 12 / 16 / 24 / 32 / 48.
- **Density:** table rows **40px** (not shadcn's default 52). Card padding 16px. Section gap 24px. This is a dense operator tool, not a marketing page.
- **Sidebar:** 260px fixed, `--shell` background, full height, scrollable.
- **Topbar:** 56px, `--shell`, holds global search + notifications + AI-priorities bell + profile + portal switcher.
- **Content:** light canvas (`--background`) against the dark shell. High contrast between chrome and content is the core visual move.

**Breakpoints:** mobile <640 · tablet 640–1024 · desktop >1024.
- Mobile: sidebar → bottom tab bar (5 items) + overflow drawer; tables → cards.
- Tablet: sidebar collapses to 64px icon rail.

---

## 5. The branded shell (carry from legacy)

### 5.1 Identity lockup — top of sidebar
```
┌────────────────────────────┐
│  [M]  Markist              │   M = 40px rounded square, --primary bg,
│       FSA COMMAND CENTER   │       white "M", DM Sans 600
└────────────────────────────┘   "Markist" = DM Sans 600, 17px, white
                                 "FSA COMMAND CENTER" = mono label token
```
Below it, a `--shell-border` divider, then the mono label `NAVIGATION`, then nav items.

### 5.2 Nav items
- 36px tall, 12px radius, DM Sans 400 14px, `--shell-foreground` at 82% opacity.
- Hover: `--shell-raised`. Active: `--shell-raised` + 2px `--accent` left bar + full-opacity text + 600 weight.
- Icons: **lucide-react**, 18px, stroke 1.75 — consistent set, no emoji.
- Count badges right-aligned: pill, `--accent` bg, white, DM Mono 11px.
- Group nav under mono labels by OS cluster (BOOK · PIPELINE · ENGAGE · OPERATE · ADMIN) rather than one flat list of 20.

### 5.3 Character panels — bottom of sidebar (carry from legacy)
These are what made the old app feel like *yours*. Rebuild them in FSOS:

**A. AI AGENTS — LIVE STATUS**
```
AI AGENTS                        ← mono label
┌────────────────────────────┐
│ LIVE STATUS                │   ← mono label, --shell-raised card
│ ● Referral Triage      12  │   ← dot: green=running, blue=idle, gold=escalated
│ ● Term Conversion       3  │
│ ● Cross-Sell            —  │
│ ● Compliance Guardrail  ✓  │   ← always-on, cannot be disabled
│ Open AI Operations →       │   ← --accent link, mono
└────────────────────────────┘
```
Wired to `fsos_agent_runs` / `fsos_ai_agents`. Escalation count links to `/app/ai/escalations`.

**B. CURRENT GDC TIER** (gold — the signature card)
```
┌────────────────────────────┐
│ CURRENT GDC TIER           │   ← mono label
│ Tier 1 — 40%               │   ← --gold, DM Sans 600, 22px
│ Under $15,000 GDC          │   ← --shell-muted, 12px
│ [config default — verify]  │   ← gold assumption chip
└────────────────────────────┘
```
Tiers are **configurable, assumption-flagged** (Tier 1 <$15k → 40% · Tier 2 $15k–54,999 → 60% · Tier 3 $55k+ → 80%). Links to `/app/commissions`.

**C. FFS KEY CONTACTS — QUICK ACCESS**
```
FFS KEY CONTACTS                 ← mono label
┌────────────────────────────┐
│ QUICK ACCESS               │
│ FSD — Central (TX)         │   ← --shell-muted 11px
│ Matt Anderson              │   ← white 13px
│ (818) 584-0264             │   ← --accent, DM Mono, tel: link
│ … (repeat per contact)     │
└────────────────────────────┘
```
Contacts are **config-driven** (`/super/config/ffs-contacts`), not hard-coded.

---

## 6. Component treatment

**Cards:** white, 1px `--border`, radius 8, shadow-none by default. Header = mono eyebrow label + h3 title. Optional right-aligned action link (`--accent`, mono, 11px).

**Tables:** header row = mono labels, `--muted` bg, 32px. Body rows 40px, 1px bottom border, hover `--muted`. Numeric columns right-aligned, DM Mono, tabular-nums. Row → detail on click (whole row, not just a link).

**Buttons:**
- Primary: `--primary` bg, white, 36px, radius 6, DM Sans 500.
- Secondary: white bg, `--border`, `--foreground`.
- Ghost: transparent, `--muted` on hover.
- Destructive: `--status-lost`.
- Never a full-width primary button on desktop.

**Status chips:** 22px, radius 4, DM Mono 10px uppercase tracked, `--status-*` at 12% bg + full-strength text.

**Assumption badge (mandatory, guardrail 3):** gold chip, mono, reading `CONFIG DEFAULT — VERIFY`, with a tooltip: *"Not a Farmers-published figure. Verify against contract."* Appears on every split %, conversion window, GDC tier, and product-availability value.

**Securities marker (mandatory, guardrail 1):** purple chip reading `FFS-MANAGED` on any `is_security` row, plus a purple 2px left border on the row. Detail pages show a purple banner: *"Securities record — managed in the FFS-supervised system. FSOS holds a reference only."* **This makes the firewall visible rather than invisible.**

**Empty states:** centered, muted lucide icon (32px), h3 title, one line of `--muted-foreground` explanation, one primary CTA. Never a blank page.

**Loading:** skeletons matching final layout (rows for tables, cards for dashboards). Never a bare spinner on a full page.

**Errors:** inline card, `--status-lost` left border, plain-English message + Retry. One failing dashboard widget must never blank the page.

**Toasts:** bottom-right, 4s, status-colored left border.

---

## 7. Applying to archetypes

| Archetype | Treatment |
|---|---|
| **A1 Dashboard** | Mono-labeled KPI tiles, DM Mono numerics, each tile links to source. Widget failure isolated. |
| **A2 List** | Dense 40px rows, mono headers, right-aligned numerics, status chips, row→detail. |
| **A3 Detail** | Dark-tinted header band with status chips + primary actions; related-records rail with mono section labels. |
| **A4 Kanban** | Column headers = mono label + count + value total; cards show status chip + DM Mono value. |
| **A5 Form** | Single column max 640px, mono field labels, inline validation, sticky action bar. |
| **A10 Settings** | Mono section labels, gold assumption badges on every config default. |
| **A11 Report** | Chart + accessible data-table fallback; export buttons top-right. |

---

## 8. Acceptance criteria
- [ ] DM Sans + DM Mono loaded via `next/font`; no system-font fallback in production.
- [ ] Dark navy shell (`--shell`) on sidebar + topbar in every portal.
- [ ] Mono uppercase labels used for every section header.
- [ ] Identity lockup (M / Markist / FSA COMMAND CENTER) present.
- [ ] All three character panels (AI Live Status, GDC Tier, FFS Contacts) live and wired to real data/config.
- [ ] Every monetary value, policy number, date, and ID renders DM Mono, tabular-nums.
- [ ] Every `is_assumption` value carries the gold badge.
- [ ] Every `is_security` row carries the purple FFS-managed marker.
- [ ] Table rows 40px; no default shadcn spacing left in place.
- [ ] Icons are lucide, consistent stroke; no emoji in the new UI.
- [ ] Empty/loading/error states styled per §6 on every page.
- [ ] Contrast passes WCAG 2.1 AA on both shell and canvas.
- [ ] Side-by-side with the legacy Command Center, FSOS reads as the same product family.
