# FSOS — Claude Code Prompt Pack

> Copy-paste prompts for driving the FSOS build. The 18 spec files ARE the standing instructions; these prompts just point Claude Code at the right files in the right order and enforce the gates. You do NOT need a prompt per spec document — you need the setup prompt, five phase prompts, and the two verification prompts below.
>
> **Order of use:** (0) Setup once → (1) Foundation → (2) P0 → (3) P1 → (4) P2 → (5) P3. Run the **Guardrail Verification** prompt at the end of Foundation and again before every go-live. Use the **Page Definition-of-Done** prompt whenever finishing any page. Use **Resume** if a session is interrupted.

---

## 0 · Setup (run once, after committing the files)
```
Read CLAUDE.md in full. Then read every file in docs/ and docs/specs/.

Confirm you understand, in your own words and briefly:
1. The three non-negotiable guardrails (securities firewall, AI green-zone/red-line, no-invented-Farmers-data).
2. The aggregate-root data model (Agency Partnership → Referral → Household → Review → Opportunity → Case → Commission).
3. The build order in docs/build-order.md and the phase gates in docs/specs/acceptance-checklist.md.
4. That NIGO is out of scope and appears nowhere.

Do NOT write any code yet. Output: (a) your understanding of the above, (b) the exact list of Foundation-phase tasks from docs/build-order.md, (c) any file that seems to conflict or is missing so I can resolve it before we start.
```

---

## 1 · Foundation phase
```
Build the FOUNDATION phase exactly as specified in docs/build-order.md (Phase 0).

Rules:
- Follow CLAUDE.md conventions: getDb() only, every API route exports dynamic='force-dynamic' and runtime='nodejs', Zod validation on all inputs, read files before editing, never recreate an existing file.
- Build in this order: scaffold + route groups → Supabase client + core schema + RLS + append-only audit_log → auth + middleware + rbac (docs/middleware-auth.md) → the four guardrail libs (firewall, guardrail validator, comms dispatcher, audit writer) → AI gateway + durable job runner → design system + archetype shells (docs/archetypes.md) → system pages.
- Do NOT build any feature page or any AI agent until the four guardrail libs exist and are enforced.

Stop condition: the Foundation gate in docs/specs/acceptance-checklist.md §2 must pass — npm run build clean, the auth test matrix passes, and a message that SHOULD be blocked (recommendation / out-of-hours / unconsented / securities) is hard-blocked and escalated, not sent. Run npm run build and fix every error before stopping. Then report each Foundation-gate item as pass/fail with evidence.
```

---

## 2 · P0 phase
```
Build the P0 (system-functional) phase per docs/build-order.md (Phase 1), using the page specs in docs/specs/p0-core.md and the archetypes in docs/archetypes.md.

Build entities in dependency (spine) order: Agency Network → Referral → Client & Household → Policy & Coverage → Opportunity & Pipeline → Tasks & Calendar → AI escalations queue → Compliance P0 surfaces → Super Admin P0 → Executive dashboard.

For each page, meet the Definition of Done in docs/archetypes.md (data wired, validation, permissions/403, empty+loading+error+success states, archived/deleted behavior, responsive, accessibility, audit events, related-record links per docs/sitemap.md §5). Enforce the RBAC matrix (docs/specs/rbac-matrix.md) and wire each screen to its tables/APIs/jobs per docs/specs/data-api-map.md.

Guardrails apply everywhere they touch: securities firewall, the 7-step comms gate, the AI red-line, and audit on every mutation.

Stop condition: the P0 gate in docs/specs/acceptance-checklist.md §2 passes — a referral flows Agency→Referral→Household→Opportunity with audit at each step, no is_security record can be sent to, and every P0 page meets Definition of Done. Run npm run build, fix all errors, and report the P0 gate as pass/fail with evidence.
```

---

## 3 · P1 phase
```
Build the P1 (professional launch) phase per docs/build-order.md (Phase 2), using docs/specs/review-conversion-crosssell.md, cases-commission.md, comms-ai-compliance.md, and portals-admin.md.

Include: Financial Review OS (the review spine), Term Conversion OS, Cross-Sell OS, Case Management OS, Commission OS, Marketing & Comms OS, Document OS, AI Operations OS, the Compliance/Partner/Client portals, Reporting library, Admin portal, the Executive intelligence surfaces, and the renewal/X-date/SLA/dormancy jobs.

Critical compliance requirements (verify in code, not just UI):
- Term Conversion and Cross-Sell expose only identify/educate/invite/schedule/remind/follow-up/escalate. There is NO "recommend product" action anywhere.
- Every automated send passes the 7-step dispatcher gate at send time.
- Template approval is limited to compliance/supervisor/super; unapproved templates are unusable.
- Client/partner portals are column-allowlisted and can never render securities fields.

Stop condition: the P1 gate in docs/specs/acceptance-checklist.md §2 passes. Run npm run build, fix all errors, and report the gate as pass/fail with evidence, plus confirm the per-workflow path proof (docs/specs/acceptance-checklist.md §3) for WF-2, WF-3, WF-4, WF-5, WF-7.
```

---

## 4 · P2 phase
```
Build the P2 (operational enhancement) phase per docs/build-order.md (Phase 3): agency map/leaderboard/health/penetration, policy lapse-risk, review-type config, analytics pages, sequences/audience builder, workflow builder, missing-document detection, reports builder + scheduled reports, commission reconciliation/chargebacks/trails/adjustments/statements, AI evaluations, admin exports/duplicates, compliance legal-holds/attestations/policies, partner training/tasks, client reviews/case-status, super workflows/sandbox/webhooks.

Constraint: no P2 feature may weaken any P0/P1 guardrail. Each page meets Definition of Done. Run npm run build, fix all errors, and confirm no acceptance-checklist item from §1 regressed.
```

---

## 5 · P3 phase
```
Build the P3 (advanced future) phase per docs/build-order.md (Phase 4): custom dashboard builder and advanced forecasting only. Do NOT build /super/billing unless I explicitly tell you FSOS is being commercialized as multi-tenant SaaS — it is a placeholder.

Each page meets Definition of Done. Run npm run build and fix all errors. Confirm no earlier guardrail or acceptance-checklist item regressed.
```

---

## ★ Guardrail Verification (run at end of Foundation, and before every go-live)
```
Do NOT add features. Prove the three guardrails actually block, with automated tests, per CLAUDE.md §2 and docs/data-guardrails.md.

Write and run tests that assert ALL of these FAIL to send / are blocked + escalated:
1. An AI-drafted client message containing a product/policy/investment recommendation ("you should buy / I recommend / the best option is") → blocked by the red-line validator.
2. Any send to a recipient with is_security=true context → blocked by the firewall.
3. A send with no valid channel consent → blocked.
4. A send outside quiet hours (recipient-local, 9:00–20:00 floor) → blocked.
5. A send to a DNC/opted-out recipient → blocked.
6. A send using an unapproved template → blocked.
7. A client-portal or partner-portal query attempting to read a securities/advice/other-party field → returns nothing (column allowlist).
8. A forbidden deep link for a role → 403, not a blank page or data leak.
9. Every one of the above writes a compliance_event/audit_log entry (blocked, not silently dropped).

Also assert the POSITIVE cases pass: a consented, in-hours, approved-template, non-securities, non-recommendation educational/invitation message DOES send.

Output a pass/fail table with the test name and evidence. Any failure is a build-blocking defect — fix it before proceeding.
```

---

## ★ Page Definition-of-Done (reuse for any single page before marking it complete)
```
For the page <ROUTE>, verify it meets the Definition of Done in docs/archetypes.md before marking complete. Check and report each:
- Real data wired (no placeholders/mock).
- Every input Zod-validated (client + server, same schema).
- Permissions enforced per docs/specs/rbac-matrix.md; forbidden deep link → 403; RLS denies out-of-scope rows.
- States built: empty, loading, error, success (+ archived/deleted if applicable).
- Responsive: desktop, tablet, mobile.
- Accessibility: labels, keyboard nav, aria, contrast (WCAG 2.1 AA).
- Related-record links present per docs/sitemap.md §5 (no dead end).
- Notifications/automations wired; audit events written on mutations (docs/specs/data-api-map.md taxonomy).
- Guardrails honored if the page touches comms/AI/securities.
- Acceptance criteria from the page's Part 2 spec met.
Output a checklist with pass/fail + evidence. Do not mark the page complete if any item fails.
```

---

## ★ Resume (if a session is interrupted)
```
We are mid-build on FSOS. Read CLAUDE.md and docs/build-order.md. Inspect the current repo state and tell me: (a) which phase and which specific pages/tables are complete vs incomplete, (b) the next task in build order, (c) any acceptance-checklist item currently failing. Then continue from the next incomplete task — do not rebuild completed work; read existing files first.
```

---

## Notes on use
- **Run phases in order.** Each phase prompt enforces its gate; don't skip a gate.
- **The gates are the safety net.** They map to docs/specs/acceptance-checklist.md — that file is the source of truth for "done."
- **Guardrail Verification is not optional.** Run it before any real client data enters the system.
- **External confirmations (I1–I6 in docs/specs/missing-requirement-analysis.md)** — commission splits, FNWL conversion window, FFS sign-off, WISP/legal review — gate GO-LIVE, not building. Resolve them in parallel; the system accepts the real values without redesign.
```
