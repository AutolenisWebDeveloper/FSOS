# FSOS Data Model, RLS & Enforced Guardrails

> The aggregate-root schema, Row-Level Security approach, and the three non-negotiable guardrails expressed as buildable code contracts. Pairs with `../CLAUDE.md` §2, §5, §7.

## 1. Aggregate-root data model (build in this dependency order)
Spine: **agency_partnerships → referrals → households → reviews → opportunities → cases → commissions.**

Core tables (abbreviated; every table also has `id uuid pk default gen_random_uuid()`, `created_at`, `updated_at`, and an owner/scope key):
```
regions, districts
agency_partnerships (ROOT)  -- agency_name, owner_name, district_id, status
                            -- (prospective|activated|producing|dormant|terminated),
                            -- relationship_strength, last_contact_at, checkin_interval_days,
                            -- pc_book_policies, life_policies_in_force, ytd_* rollups,
                            -- fnwl_serving_agent_no (Farmers agent number; directory
                            -- import natural key), office_address/city/state/zip,
                            -- existing_leads_user, interested (directory prospecting flags)
agency_owners               -- contact info (email, phone=business, mobile_phone), portal access,
                            -- contact_id → contacts (reconciled unified-book row; set by the
                            -- agency importer / Data Quality reconciler via resolution.ts)
referrals                   -- referring_agency_id, household_id?, engagement
                            -- (warm_handoff|co_sell|direct), status, received_at,
                            -- first_touch_at, sla_due_at, consent captured
households                  -- referring_agency_id, address, do_not_contact
household_members           -- household_id, full_name, dob (SENSITIVE), relationship
consents                    -- member_id, channel (call|sms|email), status, captured_at, source
carriers                    -- name, is_farmers, is_ffs (securities carrier)
products                    -- family (life|annuity|investment|education), subtype,
                            -- is_security (bool), required_license, active
policies                    -- household_id, carrier_id, product_id, status
                            -- (quoted|bound|active|lapsed|cancelled|non_renewed|renewed),
                            -- is_with_us, premium, effective/expiration/renewal dates,
                            -- x_date (generated when !is_with_us), conversion_deadline,
                            -- is_security, ffs_case_ref
coverages                   -- policy_id, coverage details, riders
reviews                     -- household_id, type (policy|coverage|term_conversion|
                            -- retirement|annual), stage, agenda, outcome, generated_opp_ids
opportunities               -- referring_agency_id, referral_id?, household_id?, product_id?,
                            -- engagement, stage (prospect|fact_find|quoted_proposed|application|
                            -- underwriting_suitability|placed_issued|lost),
                            -- is_security, license_basis_used, face_amount, premium, aum,
                            -- expected_commission, actual_commission, ffs_case_ref
cases                       -- opportunity_id, household_id, status, carrier requirements,
                            -- underwriting milestones, timeline
case_requirements           -- case_id, requirement, status, document_id?
commissions                 -- opportunity_id, referring_agency_id, product_family, is_security,
                            -- license_basis, total_commission, fsa_split_pct, agency_split_pct,
                            -- (generated) fsa_amount/agency_amount, is_trail, paid_on
commission_splits (defaults)-- product_family, fsa_split_pct, agency_split_pct,
                            -- is_assumption (bool, default true), note
campaigns, campaign_enrollments
documents                   -- entity refs, classification, version, retention, legal_hold
activities, tasks, appointments
ai_agents, agent_runs, agent_actions
compliance_events           -- firewall hits, blocked sends, escalations
audit_log (append-only)     -- actor, action, entity, entity_id, diff, at
```
Computed views: `v_top_agencies`, `v_agencies_overdue_checkin`, `v_referrals_awaiting_action`, `v_pipeline_by_engagement`, `v_commission_by_agency`, `v_cross_sell_gaps` (household lines held vs. recommended basket → next_best_line), `v_conversions_due`.

## 2. Row-Level Security (every client/agency table)
- Enable RLS on every table holding agency/household/client data.
- **fsa/licensed_staff:** rows within their book (`agent_id = auth.uid()` or team mapping).
- **agency_owner:** `agency_id ∈ current_user_agencies()`.
- **client:** `household_id = current_user_household()` AND a **column allowlist** excluding any `is_security` / advice / commission columns.
- **compliance/supervisor:** broad read; writes limited to approvals/exceptions/incidents.
- **Writes** for partner/client portals routed through server actions using the service role AFTER an `rbac` scope assertion (never trust the client).
- **audit_log** is append-only: the app role has INSERT only; no UPDATE/DELETE grant.
- **PII:** `dob` (and any future SSN-class field — none currently) encrypted with `pgcrypto`; key held outside the DB (env/KMS).

## 3. GUARDRAIL 1 — Securities firewall (`lib/compliance/firewall.ts`)
```
assertNotSecuritiesSystemOfRecord(payload):
  # FSOS may store: existence, stage, engagement, agency, expected/actual commission, ffs_case_ref
  # FSOS may NOT store: securities account numbers, order details, suitability determinations,
  #                     securities client communications
  reject if payload contains any securities account/order/suitability/comms field
isSecurity(entity): entity.is_security === true
# Every comms send and every AI action checks isSecurity → if true: block automated handling, route to human/FFS.
```
- `opportunities`, `policies`, `cases`, `commissions` carry `is_security`; when true they are excluded from automated SMS/email and flagged for FFS-supervised handling.
- The client portal API applies a column allowlist that can never return `is_security` rows/fields.

## 4. GUARDRAIL 2 — AI green-zone / red-line (`lib/compliance/guardrail.ts`)
```
validateAIClientMessage(draft, context) -> {allow|block, reasons[]}:
  block if containsRecommendationLanguage(draft)      # product/policy/investment/replacement/
                                                      # allocation/transaction "call to action"
  block if context.is_security
  block if !hasValidConsent(context.recipient, context.channel)
  block if !withinQuietHours(context.recipient_local_now)   # conservative 9:00–20:00 floor
  block if onDNC(context.recipient)
  block if !usesApprovedTemplateOrPolicy(draft)
  else allow
# Blocked → write compliance_event + create escalation task for the human FSA. NEVER send.
```
Escalation triggers (route to human FSA): client requests advice/recommendation · securities discussion needs FFS channel · consent unclear · compliance rule triggered · replacement/suitability/best-interest/supervision issue · conflicting/incomplete case info · high-value/urgent opportunity.
Green-zone (allowed autonomously): identify · educate · invite · schedule · remind · follow up · run approved/consented campaigns · draft internal · assemble data · log.

## 5. GUARDRAIL 3 — Communications gate (`lib/comms/gate.ts` → `lib/comms/dispatcher.ts`)

> **Canonical enumeration.** This section is the single source of truth for the gate's steps and order. Other docs cite it rather than re-listing the steps. The pure decision core is `evaluateGate` in `src/lib/comms/gate.ts`; `dispatcher.ts` wires it to consent/DNC lookups, audit, escalation, and the actual senders. The original gate had **7 checks**; as the native communications platform was built (Slices 1–8) it grew to **13 ordered steps**.

Every automated SMS/email passes these **13 steps in order, blocking on the first failure** and logging the block. Steps 1–10 are **escalating compliance blocks** (a block escalates to the human FSA); steps 11–13 are **non-escalating operational deferrals** (held/dropped for this cycle, not a compliance violation), checked LAST so a real compliance failure can never be masked by a benign deferral:

1. **ownership** — authoritative ownership (agency / agency-owner / represented-agent / actual sender) must resolve; unresolved → assignment-review queue. *Escalates.*
2. **consent** — valid channel consent on file. *Escalates.*
3. **quiet_hours** — recipient-local **9:00–20:00** TCPA floor (non-negotiable). *Escalates.*
4. **delegation** — the FSA↔agency-owner on-behalf-of authority is ACTIVE and in-scope. *Escalates.*
5. **dnc** — not on internal/external do-not-contact. *Escalates.*
6. **approved_template** — approved template or approved AI policy. *Escalates.*
7. **recommendation** — no individualized product/investment/replacement/allocation call-to-action. *Escalates.*
8. **is_security** — record/recipient not securities-flagged. *Escalates → FFS-supervised handling.*
9. **data_confidence** — a *specific* claim (deadline, ownership, lapse/age/appointment status) rests on verified, non-conflicting, above-threshold data. *Escalates → verification task; never sent on a guess.*
10. **other_rule** — any FFS/Farmers/carrier/state/federal rule block. *Escalates.*
11. **business_hours** — within the operator's configured hours of operation (can only tighten the legal floor). *Operational deferral — does NOT escalate* (held for the next in-hours cycle).
12. **frequency** — within the recipient's configured rate caps. *Operational deferral — does NOT escalate.*
13. **collision** — a higher-priority campaign or active conversation is underway, so this promotional send pauses. *Operational deferral — does NOT escalate.*

Blocked (escalating) sends → `compliance_events` + escalation; never silently dropped. All sends (and blocks) audited. New gate inputs are default-permissive, so an existing call site that does not set a new dimension keeps its prior behavior.

## 6. GUARDRAIL 4 — No invented Farmers data (config-default pattern)
Any value that is not publicly documented ships as an editable default with `is_assumption = true` and a UI **"config default — verify"** badge (archetype A10). Applies to: commission splits (`commission_splits`), FNWL term-conversion windows (`products.conversion_window_*`), product availability (`products.active`), carrier rules, and any Farmers/FFS API availability.
```
DEFAULT (labeled assumption, NOT a Farmers figure) — replace with contract terms:
  commission_splits: fsa 60 / agency 40 per product_family, is_assumption = true
  conversion_window: per-product, is_assumption = true (source: ICC25-FTL contract / FNWL SERFF filing)
```
Do NOT invent an integration/API that has not been verified. Where none exists, implement the configured manual / CSV-import / secure-reference-field fallback, labeled placeholder.

## 7. Audit (every mutation)
On create/update/delete of any business entity, and on every AI action and every send/block, write `audit_log` (actor, action, entity, entity_id, diff, at) via `lib/audit/log.ts`. Retain ≥ 7 years (config). Sensitive-entity views also audited.
