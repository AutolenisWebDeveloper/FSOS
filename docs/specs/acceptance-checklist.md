# FSOS Part 5 — Acceptance Checklist & Pre-Launch Verification

> The master completeness sign-off. FSOS is not "done" until every item is verifiably true. Organized as (1) the non-negotiable completeness checklist, (2) phase gates (nothing advances until its gate passes), (3) the per-workflow path proof, (4) the go-live gate. Pair with Part 3 (workflows), Part 4 (RBAC/data), and `../build-order.md`.

---

## 1. Non-negotiable completeness checklist (the original standard, verified)
- [ ] **No dead navigation links.** Every list→detail→related-record resolves (Part 1 §5 link sets). Only completion screens terminate, and each offers a next action.
- [ ] **No missing pages.** Every route in `../sitemap.md` exists at its `../routes.md` path and renders.
- [ ] **No form without validation.** Every input Zod-validated, client + server, same schema.
- [ ] **No workflow stops unexpectedly.** Every Part 3 workflow passes all 8 paths (§3 below).
- [ ] **No role without its pages.** Every portal's nav is permission-filtered; every role can reach everything the RBAC matrix grants.
- [ ] **No protected page without enforcement.** Forbidden deep link → 403 (never blank); RLS denies out-of-scope rows.
- [ ] **No automated action without audit.** Every mutation, send, block, AI action, stage change writes `audit_log` (Part 4 taxonomy).
- [ ] **No AI agent exceeds permissions.** Green-zone tools only; red-line recommendation hard-blocked in eval (a slip = build-blocking defect).
- [ ] **No securities workflow crosses the firewall.** `is_security` never auto-sent; client/partner portals never expose securities fields; suitability is a pointer, not stored.
- [ ] **No communication bypasses consent + suppression.** 13-step dispatcher gate at send time (`../data-guardrails.md` §5); no "force send" control exists.
- [ ] **No feature complete unless wired to real data.**
- [ ] **No invented Farmers data.** Every split/window/product-availability/carrier-rule value is an assumption-flagged, editable config default with a "verify" badge.
- [ ] **NIGO appears nowhere** in the codebase, schema, agents, reports, or UI.

---

## 2. Phase gates (from `../build-order.md`; each must pass before the next phase)

**Foundation gate:**
- [ ] `npm run build` clean.
- [ ] Auth test matrix passes (middleware-auth §8): permitted loads · anonymous→login · wrong-role→403 · no-MFA→mfa · out-of-scope row denied · super-only enforced · client cannot load `is_security`.
- [ ] The four guardrail libs exist and are enforced: firewall, guardrail validator, dispatcher gate, audit writer.
- [ ] A test message that should be blocked (recommendation / out-of-hours / unconsented / securities) is hard-blocked + escalated, not sent.
- [ ] Append-only `audit_log` verified tamper-evident (app role has INSERT only).

**P0 gate:**
- [ ] Referral flows Agency→Referral→Household→Opportunity with audit at each step.
- [ ] No `is_security` record can be sent to; securities opp stores only `ffs_case_ref`.
- [ ] Every P0 page is wired to real data with validated inputs, enforced permissions, and audit events.
- [ ] AI escalations queue exists and is the only blocked→resolved path.

**P1 gate:**
- [ ] Financial Review spine live (schedule→prep→outcome→opportunity origination).
- [ ] Every automated send passes the 13-step gate (`../data-guardrails.md` §5); every agent run logs confidence + cost.
- [ ] Compliance, Partner, Client portals enforce scope + column allowlists.
- [ ] Template approval limited to compliance/supervisor/super; unapproved templates unusable.

**P2/P3 gates:** no P2/P3 item weakens a P0/P1 guardrail.

---

## 3. Per-workflow path proof (Part 3 — every workflow, every path)
For each of WF-1…WF-11, verify all eight:
- [ ] **Happy** completes end to end.
- [ ] **Empty** handled (no data / no products / no audience / no gaps).
- [ ] **Error** handled (integration down, save fail) without corruption.
- [ ] **Unauthorized** blocked (scope/securities/comp-disclosure).
- [ ] **Duplicate** deduped/idempotent (no double household/opportunity/send/commission).
- [ ] **Cancellation** clean (reject/cancel/opt-out, no orphans).
- [ ] **Retry** idempotent (no doubles on retry).
- [ ] **Recovery** routes to a queue/escalation, never silence.

Workflows: WF-1 Referral→Placement · WF-2 Review lifecycle · WF-3 Term Conversion · WF-4 Cross-Sell · WF-5 Campaign Send · WF-6 Agency Activation/Dormancy · WF-7 Commission Reconciliation · WF-8 Agent Run→Escalation · WF-9 Consent Capture/Revocation · WF-10 Incident/Breach · WF-11 Data Import.

---

## 4. QA coverage sign-off (from build-order QA matrix)
- [ ] Permission/RLS tests (every protected route + out-of-scope row).
- [ ] Communication-gate tests (each of the 7 steps blocks correctly).
- [ ] AI-guardrail tests (recommendation, securities, out-of-hours, unconsented all blocked).
- [ ] Security tests (rate limit, bot, file upload, secrets, injection/XSS/CSRF).
- [ ] Performance · load.
- [ ] Backup · restore (tested restore, not just backup exists).
- [ ] Data-migration (import preview/commit/rollback) · failure/retry.

---

## 5. Go-live gate (business/legal confirmations — External items I1–I6)
These do not block building; they block go-live. Confirm before the FSA uses FSOS with real client data:
- [ ] **Commission splits** replaced with real contract terms (remove assumption defaults where confirmed).
- [ ] **FNWL term-conversion window + eligible products** populated from the ICC25-FTL contract / FNWL SERFF filing.
- [ ] **Farmers/FFS API availability** verified; where none, manual/CSV fallback confirmed acceptable.
- [ ] **FFS written sign-off** on what FSOS may store re: securities clients, and confirmation the securities firewall boundary is acceptable.
- [ ] **WISP, Reg S-P incident plan, TCPA/Texas SB 140 posture** reviewed by counsel/compliance.
- [ ] **Approved communication templates** reviewed by FFS compliance for the Reg BI "recommendation" boundary (green-zone education/invitation only).
- [ ] **Licenses/appointments** current in `/app/compliance/licenses`; product paths gated to held registrations.
- [ ] **MFA enforced** for all FSA/staff/admin/super; backups tested; kill switches functional.

---

## 6. Final statement of completeness
When Sections 1–4 are fully checked, FSOS is **structurally, functionally, and technically complete**: every page exists and connects, every form validates, every workflow completes or recovers, every role is enforced, every action is audited, every guardrail holds, and no Farmers data is invented. When Section 5 is also confirmed, FSOS is **cleared for production use** with real client data.

This checklist, with Parts 1–4, is the authoritative proof that the failure pattern — missing pages, dead links, incomplete flows, unwired forms, un-enforced permissions, un-built error states, halted automations, forgotten admin functions — has been eliminated by design, not left to be discovered later.
