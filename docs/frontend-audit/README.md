# FSOS Frontend Audit — Deliverables Index

Fortune-500 fintech frontend audit, redesign, validation & production-readiness
initiative. **Frontend only** — no backend/schema/RLS/compliance/securities
change. Delivered as CI-gated vertical slices (draft PR per slice).

## Documents

| Doc | What it is |
|---|---|
| [`inventory-and-defect-register.md`](./inventory-and-defect-register.md) | Full frontend inventory (253 pages / 6 portals + public) and the prioritized defect register (Critical→Low) with per-item status. |
| [`plan.md`](./plan.md) | Phased implementation plan — the design-consistency baseline and the vertical slices (0 → 5), merge policy, and Definition of Done. |
| [`a2p-10dlc-website-compliance.md`](./a2p-10dlc-website-compliance.md) | Twilio A2P 10DLC / TCPA / TRAIGA website-surface compliance report vs the `twilio-a2p-compliance` checklist, incl. human-action items. |

## Session verification report (Slice 0)

**Baseline (deps installed):** type-check ✅ · lint ✅ (exit 0) · `npm test` ✅ (28+ suites incl. guardrail/auth/compliance) · `next build` ✅ (all 253 routes).

**Changes shipped this session (Slice 0 — shared baseline + CI):**

| Change | File | Defect |
|---|---|---|
| Add `next build` gate to CI | `.github/workflows/ci.yml` | §12 CI precondition |
| Reconcile as-built token tables + `--status-lost` hue | `DESIGN.md` | H1 (doc drift) |
| Financial-negative delta uses `--status-lost`, not `--destructive` | `dashboards/primitives.tsx` | H2 (guardrail §15.2) |
| Add + export `TableCaption` (documented, was missing) | `ui/table.tsx` | M1 (a11y) |
| Skip-to-content link + `<main id="content">` on all 6 authenticated portals | `portal/PortalShell.tsx` | M2 (WCAG 2.2 AA) |
| Wizard steps signal state via icon + text, not color alone | `archetypes/shells.tsx` | M3 (WCAG SC 1.4.1) |

**Post-change verification:** type-check ✅ · lint ✅ · `npm test` ✅ · `next build` ✅.

**Scope confirmation:** diff is frontend/docs/CI only — no changes under
`supabase/migrations`, no RLS/policy, no `lib/comms` gate/dispatcher, no
`lib/ai`, no securities firewall, no API response contracts, no business logic,
no A2P/TCPA consent or legal-page copy. Compliance/consent/securities indicators
untouched.

**No approval gate.** Website content — legal, privacy, terms, SMS/A2P consent
copy, forms — ships **compliant-by-construction**, written accurately against the
`twilio-a2p-compliance` / `finra-rule-ingestion` references. No page requires a
named individual's prior sign-off to go live — the FSA owns publish. Residual
regulatory/legal/carrier risk is **documented with a recommendation**, never
treated as an approval bottleneck; real business-specific values are left as
`[[FSA TO PROVIDE]]` placeholders.

**Not done here (reported, not fixed):** invite/verify auth stubs (need
**backend** routes); A2P consent-copy standardization + TRAIGA disclosure
(Slice 1, written directly — no gate); per-portal redesign Slices 1–5;
browser-based visual responsive/a11y capture; A2P 10DLC campaign registration
(FSA console task). See `plan.md` and `a2p-10dlc-website-compliance.md`.

## How to continue

Pick up at **Slice 0-b** (shared a11y + chart-token pass, needs visual verify)
or **Slice 1** (public + auth), per `plan.md`. Each slice: audit → fix to the
baseline → validate (type-check/lint/test/build + responsive + a11y) → one draft
PR with evidence → stop for human review on any legal-gated copy.
