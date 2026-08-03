# Accessibility & Responsive — Manual Pre-Ship Checklist (booking surfaces)

> **Run this once before each production ship of the booking program.** It closes the a11y /
> responsive / screen-reader pre-ship gate (`deploy-notes.md`; decision: `docs/adr/ADR-035-a11y-preship-checklist.md`).
> Standard: **WCAG 2.2 AA** (CLAUDE.md §13.1). No automated harness — this is a human pass.
> Record the date + who ran it + result at the bottom.

## Surfaces to check
Public: **`/schedule`** (type chooser → slot picker → details → confirmation), `/schedule/success`.
Internal (FSA): **`/app/calendar`**, **`/app/calendar/[id]`** (detail), **`/app/booking`** (settings).

## Tools
- **Keyboard only** (unplug the mouse or commit to Tab/Shift-Tab/Enter/Space/Esc/arrows).
- **axe DevTools** browser extension (free) — run "Scan ALL of my page" on each surface.
- Browser **responsive mode** (or resize) at ~**375px** (mobile), **768px** (tablet), **1280px** (desktop).
- A screen reader for a spot-check: **VoiceOver** (macOS ⌘+F5) or **NVDA** (Windows).

## A. Automated scan (axe extension) — per surface
- [ ] Run axe DevTools on each surface above. **Zero serious/critical** issues. Log/triage any
      moderate items.
- [ ] Re-run after interacting (open the slot picker, open a detail, open a settings dialog) — scan
      the interacted state too.

## B. Keyboard operability — per surface
- [ ] Every interactive control is **reachable** by Tab and **operable** by Enter/Space (and arrows
      where relevant: calendar grid, slot list, selects).
- [ ] **Focus order** is logical (follows visual order); no keyboard trap.
- [ ] **Visible focus ring** on every focused control (never `outline:none` without a replacement).
- [ ] Dialogs/menus: focus moves in on open, **Esc closes**, focus returns to the trigger.
- [ ] Destructive/irreversible actions (cancel, reschedule, remove availability) are reachable and
      show their confirm step via keyboard.

## C. Screen-reader spot-check — key flows
- [ ] `/schedule`: the flow announces step, the picked time, and the confirmation meaningfully.
- [ ] `/app/calendar`: KPIs, the list, and the timeline have sensible names/roles; the
      appointment status controls announce their action.
- [ ] Form fields have **programmatic labels** (not placeholder-only); errors are announced.
- [ ] Images/icons are labelled or `aria-hidden`; status badges convey meaning by **text**, not color
      alone.

## D. Responsive — each breakpoint (375 / 768 / 1280)
- [ ] No horizontal page scroll; wide tables / the calendar grid scroll **inside** their own
      container.
- [ ] Tap targets are adequately sized; nothing overlaps or is clipped.
- [ ] KPI strips / grids reflow; the settings forms remain usable.

## E. Colour & contrast
- [ ] Text and UI meet **AA contrast** (axe flags most; spot-check brand navy/blue on canvas).
- [ ] Meaning is never carried by **colour alone** (status = text + badge; links distinguishable
      without relying on colour).

---

## Sign-off
| Ship date | Run by | Result (pass / issues filed) | Notes |
|---|---|---|---|
| _pending first pre-ship run_ | | | |
