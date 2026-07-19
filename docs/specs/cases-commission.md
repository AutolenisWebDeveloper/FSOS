# FSOS Part 2 — Page Specs: Case Management · Commission

> Override specs on top of `../archetypes.md`. Case Management is NIGO-free (application → underwriting → issue → service). Commission carries the assumption-flagged split model; securities commissions are tracked for the FSA's own production but the securities activity itself lives in FFS-supervised systems.

---

## OS-10 Case Management (NIGO-free)

Tracks a life/financial application from submission through issue and into service. No defect-prevention/NIGO scoring anywhere.

### Case Directory
- **Route/Archetype/Roles:** `/app/cases` · A2 · fsa, licensed_staff, case_manager
- **Data:** `cases` + opportunity + household + carrier + status + outstanding requirement count + is_security.
- **Filters:** status, carrier, product family, outstanding-requirements, is_security, assigned. **Search:** case #, insured name, policy #. **Sort:** submitted date, status age.
- **Permissions:** in-book (FSA) or assigned (case_manager). `is_security` cases show FFS-pointer banner; substantive securities records not stored.
- **AI:** Case Management agent tracks milestones + drafts consented status updates (green-zone); Document Intelligence flags missing documents.
- **Audit:** view/export logged. **Related links:** row → case detail.
- **Acceptance:** empty state → "Open a case from an opportunity"; securities cases never store order/suitability data.

### Case Board
- **Route/Archetype:** `/app/cases/board` · A4
- **Stages:** submitted → underwriting → requirements-outstanding → approved → issued → in-service (+ declined/withdrawn). Drag → audit.
- **Acceptance:** stage changes logged; requirements-outstanding stage links to the requirements list.

### Open Case / Case Detail
- **Routes/Archetype:** `/app/cases/new` (A5), `/app/cases/[id]` (A3)
- **Create:** from an opportunity (req) → carries household, product, carrier, is_security. **Validation:** Zod; if is_security, creator needs securities scope.
- **Detail sections:** application summary · submission tracking · underwriting milestones · carrier requirements · outstanding requirements · documents · signature/form-version verification · status tracking · issue tracking · service requests · case timeline.
- **Primary actions:** update status, add/resolve requirement, request document (through comms gate), record issue, open service request, link commission on issue.
- **Compliance:** securities underwriting/suitability is a **status pointer** to FFS; FSOS records progress, not the suitability determination. Replacement cases flag the replacement-notice requirement.
- **AI:** milestone tracking + consented status-update drafts (guardrail-validated); missing-document detection.
- **Audit:** view + status/requirement/issue changes logged.
- **Related links:** opportunity · household · product · carrier · requirements · documents · commissions · service requests · timeline.
- **Acceptance:** no NIGO artifacts; every outstanding requirement is actionable and links to a document request; issue event can spawn the commission record.

### Submission Checklist
- **Route/Archetype:** `/app/cases/[id]/checklist` · A3
- **Data:** required items per product/carrier (config-driven; carrier rules are assumption-flagged config, never invented).
- **Actions:** mark item complete, attach document, request from client. **Acceptance:** checklist completeness is informational (readiness), NOT a NIGO/defect score; carrier rules badged "config — verify."

### Requirements / Service Requests
- **Routes/Archetype:** `/app/cases/requirements` (A2), `/app/cases/service-requests` (A2)
- **Requirements:** outstanding items across all cases; bulk request (through gate). **Service requests:** post-issue policy service items. **Audit:** logged.

---

## OS-11 Commission

Tracks expected/received/pending commissions and FSA↔agency splits. **Splits are labeled config defaults — never invented.** Securities commissions are tracked for production/attribution; the securities transaction record itself is FFS's.

### Commission Dashboard
- **Route/Archetype/Roles:** `/app/commissions` · A1 · fsa (licensed_staff read; agency-owner sees only their own attributed, permission-gated, in P-4)
- **Widgets:** expected vs received (period), pending, by product family (life vs investment), by agency (top), discrepancies, chargeback exposure.
- **AI:** Commission Reconciliation agent flags expected-vs-received gaps (green-zone; no financial advice).
- **Audit:** view/export logged. **Acceptance:** every tile links to its list; life vs securities split visible.

### Expected / Received / Pending
- **Routes/Archetype:** `/app/commissions/{expected,received,pending}` · A2
- **Data:** `commissions` rows + opportunity + agency + product_family + is_security + split amounts (generated) + is_trail + paid_on.
- **Filters:** product family, agency, is_security, period, trail vs first-year. **Sort:** amount, paid_on.
- **Acceptance:** fsa_amount + agency_amount reconcile to total; assumption-flagged splits badged.

### Split Configuration
- **Route/Archetype:** `/app/commissions/splits` · A10
- **Data:** `commission_splits` defaults per product family (fsa_split_pct / agency_split_pct, is_assumption=true, note).
- **Fields + validation:** percentages must sum to 100; per-agency contract overrides supported.
- **Compliance/UI:** every default renders "config default — verify with contract; not a Farmers-published figure." **Audit:** every change logged before/after.
- **Acceptance:** no split value is presented as authoritative; overrides supersede defaults per agency/product.

### Commission Record Detail
- **Route/Archetype:** `/app/commissions/[id]` · A3
- **Data:** opportunity, agency, product_family, is_security, license_basis, total, split %s, generated amounts, is_trail, paid_on, reconciliation status.
- **Related links:** opportunity · agency · household · case. **Audit:** view + edits logged.
- **Acceptance:** license_basis recorded (life-only vs securities registration); securities commission has an FFS reference, no order data.

### Reconciliation / Discrepancies / Chargebacks / Trails / Adjustments / Statements
- **Routes/Archetype:** A3 (reconciliation), A2 (others)
- **Reconciliation:** match expected to received; flag gaps → `/discrepancies`. **Chargebacks:** track clawbacks against placed business. **Trails:** recurring/12b-1-style trail tracking (config). **Adjustments:** manual corrections (audited). **Statements:** period statements + export.
- **Audit:** all changes logged. **Acceptance:** discrepancies are actionable; adjustments require reason + are diffed; exports logged.

---

*Next: `comms-ai-compliance.md` (Marketing & Comms, AI Operations, Compliance — where guardrails are enforced in the UI), then `portals-admin.md`.*
