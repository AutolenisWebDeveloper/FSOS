# FSOS Page Archetypes & the 40-Point Completeness Standard

> Every page in `sitemap.md` declares one archetype and inherits its full definition below.
> A page-specific spec (future Part 2) only records what it OVERRIDES. This makes each page complete without 200× duplication.
> Build reusable shells in `components/archetypes/`.

## The 40-point standard (what "complete" means for any page)
1 name · 2 route · 3 portal · 4 authorized roles · 5 purpose · 6 entry points · 7 exit points · 8 parent nav · 9 child pages · 10 required data · 11 primary actions · 12 secondary actions · 13 filters · 14 search · 15 sorting · 16 pagination · 17 bulk actions · 18 form fields · 19 validation · 20 permission rules · 21 empty state · 22 loading state · 23 error state · 24 success state · 25 archived state · 26 deleted behavior · 27 mobile · 28 tablet · 29 desktop · 30 accessibility · 31 notifications · 32 automations · 33 AI involvement · 34 audit events · 35 integrations · 36 DB entities · 37 API endpoints · 38 reports/exports · 39 acceptance criteria · 40 build priority.

**Definition of Done (applies to EVERY page):** real data wired (no placeholders) · every input Zod-validated · permissions enforced (403 on forbidden deep link) · empty + loading + error + success states built · archived + deleted behavior built · responsive desktop/tablet/mobile · accessible (labels, keyboard, aria, contrast) · notifications/automations wired · audit events written on mutations · no dead ends except completion screens (which offer a next action).

---

## A1 — Dashboard / Command Center
KPI + widget canvas, read-oriented.
- **States:** empty = "no data yet / connect a source"; loading = skeleton cards; error = per-widget error + retry (page survives one widget failing); success = live tiles.
- **Responsive:** desktop multi-col grid · tablet 2-col · mobile stacked (priority widgets first).
- **A11y:** each widget a labeled landmark; charts have data-table fallback + aria summary; keyboard widget order.
- **Rule:** every KPI tile links to its underlying list/detail (no dead ends).
- **Audit:** view logged on compliance/exec dashboards; export logged.

## A2 — List / Index (table)
- **Controls:** search · filter set · column sort · server-side pagination (default 25) · saved views · bulk actions (confirm) · row→detail · column chooser · export (CSV/PDF where permitted).
- **States:** empty = illustration + create CTA + explanation; loading = row skeletons; error = full-width retry; archived = toggle to include (row badge); deleted = soft-deleted hidden, restorable in Admin.
- **Responsive:** desktop full table · tablet condensed columns · mobile card list (key fields + overflow menu).
- **A11y:** semantic table; sort state announced; keyboard row actions; bulk-select announced.
- **Audit:** export + bulk actions logged.

## A3 — Detail / Record page
- **Standard:** header (name, status, key metadata, primary actions) · tabbed/sectioned body · **related-records rail linking to ALL connected entities** (anti-dead-end, see sitemap link sets) · activity/audit timeline · breadcrumb.
- **States:** loading = header+section skeletons; error = record-level retry; not-found = 404 + back-link; permission-denied = 403 explaining access; archived = read-only banner + restore (if permitted); deleted = tombstone + restore (Admin) or hard-deleted message.
- **Responsive:** desktop header + 2-pane (body + rail) · tablet body + collapsible rail · mobile stacked, related as accordion.
- **A11y:** heading hierarchy; tab semantics; timeline as ordered list.
- **Audit:** view logged for sensitive entities (household, policy, commission, compliance, case).

## A4 — Kanban / Board
- **Standard:** columns=stages · cards=records · drag=stage change (writes stage_history + audit) · WIP counts · per-column totals · card→detail · filter/segment bar.
- **States:** empty column msg; loading skeletons; board-level retry; drag failure snaps back + toast.
- **Responsive:** desktop horizontal columns · tablet scrollable · mobile single-column stage selector + "move to stage" action (no drag).
- **A11y:** keyboard move menu; aria-live announces moves.
- **Audit:** every stage change logged (actor + timestamp).

## A5 — Form / Create-Edit
- **Standard:** grouped fields · inline + submit validation · required marking · unsaved-changes guard · save / save-and-continue / cancel · optimistic disable on submit · per-field server-error surfacing.
- **States:** loading (edit) = field skeletons; saving = disabled + spinner; success = toast + redirect/stay; validation error = inline + focus first error; permission-denied = read-only or 403.
- **Responsive:** single-column mobile · multi-column groups desktop.
- **A11y:** label-for every input; errors via aria-describedby; focus management; no color-only errors.
- **Validation:** Zod schema is the source of truth; same schema client + server.
- **Audit:** create/update logged with field-level diff for sensitive entities.

## A6 — Wizard / Multi-step
- **Standard:** step indicator · per-step validation · back/next · save-draft/resume · review-before-submit · completion screen with next actions.
- **States:** per-step loading/error; resumable draft; abandonment recovery.
- **Responsive:** vertical stepper mobile.
- **A11y:** step changes + progress announced non-visually.

## A7 — Modal
Focus-trapped overlay task. ESC + backdrop close (unless destructive) · primary/secondary actions · scroll-lock behind · loading/error inside modal · success closes + toast · full-screen sheet on mobile · role=dialog, aria-modal, focus returns to trigger.

## A8 — Drawer / Side-panel
Contextual detail/edit without leaving page. Modal rules, side-anchored. Used for quick-view of a related record from a list/board.

## A9 — Confirmation / Destructive / Completion
Explicit consequence text · typed-confirmation for destructive (delete/bulk) · danger styling · cancel default-focused. Completion screens ALWAYS offer a next action (view record / return to list / start another) — the only permitted "dead ends." Confirmed action always logged.

## A10 — Settings / Configuration
Sectioned settings · immediate or explicit-save · permission-gated fields · **"config default / assumption" badge** on any Farmers-data value (splits, conversion windows, product availability, per `data-guardrails.md`) · change history. Every config change logged before/after.

## A11 — Report / Analytics view
Filter/date/segment params · table + chart · export (CSV/PDF) · schedule (email delivery) · saved report · role-based data scoping. States: no-data-for-params · long-run loading · export-in-progress. Generation + export logged.

## A12 — Integration / Connection
Status (connected/disconnected/error/degraded) · connect/reconnect/disconnect · credential entry (secrets never displayed) · test-connection · last-sync · failure log · recovery guidance. **Never invents an unavailable API** — where none exists, shows the configured manual/CSV/reference-field fallback, labeled as a placeholder. Connect/disconnect/credential-change logged.

## A13 — Auth / System page
Login, MFA, reset, invite, 403, 404, 500, maintenance, offline. Minimal chrome · clear recovery path · no dead ends (every error links home/support) · rate-limited · bot-protected.

---

## Design system (apply across all archetypes)

> **Superseded by [`docs/design-system.md`](./design-system.md).** The FSOS Design
> System (dark navy shell + light canvas, DM Sans / DM Mono, signature gold, visible
> securities firewall) is now the authoritative visual spec. Read it before building
> any UI. The paragraph below is retained for historical context only.

Professional financial-services aesthetic (not a generic template). Tailwind + shadcn/ui. Define once and reuse: typography scale · spacing scale · 12-col grid · color system with **status colors** (draft/active/pending/won/lost/blocked/escalated) · icon set · buttons · inputs · tables · cards · charts · modals · drawers · toasts · empty-state illustrations · loading skeletons · error messages · confirmation patterns · print layouts (for reports/statements). Accessibility target: WCAG 2.1 AA. Responsive breakpoints: mobile <640 · tablet 640–1024 · desktop >1024. Dark mode: optional (P2); ship light-first with tokens ready.
