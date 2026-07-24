# FSOS Part 4 — Role & Permission Matrix

> Authoritative RBAC for FSOS. Two enforcement layers, both required: coarse portal gate (`../middleware-auth.md`) + fine-grained row/action checks (`lib/auth/rbac.ts` + RLS). This matrix is the source of truth edited at `/super/permissions`.
> Action verbs: **V** view · **C** create · **E** edit · **D** delete(soft) · **A** approve · **X** export · **M** communicate (send through the gate) · **G** configure · **N** administer (platform).
> Legend: ✅ full · 🔶 scoped (own book/agency/household) · 🔒 permission-gated (config flag) · 🚫 none · 📝 always audited.

---

## 1. Roles (recap)
`super_admin · fsa · licensed_staff · admin · ops · case_manager · compliance · supervisor · agency_owner · client`

## 2. Override gates (evaluated BEFORE the base grid)
- **Securities scope gate:** any entity with `is_security=true` — create/advance/communicate requires an active securities registration on the actor. `licensed_staff.securities_scope=false` → 🚫 on securities actions. Securities communication is NEVER sendable from FSOS by anyone (routes to FFS). 📝 firewall event on every block.
- **Comp-disclosure gate:** `agency_owner` may view attributed commissions only where `agency.comp_disclosure=true`; else 🚫 (nav hidden + 403 on deep link).
- **Consent gate:** any **M** (communicate) action requires valid channel consent + quiet-hours + not-DNC at send time, regardless of role. Fails → blocked + ⤴ escalation, never sent.
- **Client/partner column allowlist:** client & agency_owner reads are column-filtered; securities/advice/other-party fields are never returned.
- **Kill switch:** AI-initiated actions additionally require the per-agent + global switch on.

---

## 3. Master matrix — by entity × role

> Cells show the max grant; override gates above can reduce it. Empty back-office/admin cells default 🚫.

### Agency Partnership (aggregate root)
| Role | V | C | E | D | A | X | M | G | N |
|---|---|---|---|---|---|---|---|---|---|
| super_admin | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| fsa | 🔶 | ✅ | 🔶 | 🔶📝 | 🚫 | 🔶 | 🔶 | 🚫 | 🚫 |
| licensed_staff | 🔶 | 🔶 | 🔶 | 🚫 | 🚫 | 🔶 | 🔶 | 🚫 | 🚫 |
| admin | 🔶 | 🚫 | 🔶 | 🚫 | 🚫 | 🔶 | 🚫 | 🔶 | 🚫 |
| ops / case_manager | 🔶 | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 |
| compliance / supervisor | ✅(read) | 🚫 | 🚫 | 🚫 | 🚫 | ✅ | 🚫 | 🚫 | 🚫 |
| agency_owner | 🔶(self) | 🚫 | 🔶(profile prefs) | 🚫 | 🚫 | 🚫 | 🔶 | 🚫 | 🚫 |
| client | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 |

### Referral
| Role | V | C | E | D | A | X | M | G | N |
|---|---|---|---|---|---|---|---|---|---|
| super_admin | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| fsa | 🔶 | ✅ | 🔶 | 🔶📝 | 🚫 | 🔶 | 🔶 | 🚫 | 🚫 |
| licensed_staff | 🔶 | ✅ | 🔶 | 🚫 | 🚫 | 🔶 | 🔶 | 🚫 | 🚫 |
| admin/ops | 🔶 | 🔶 | 🔶 | 🚫 | 🚫 | 🔶 | 🚫 | 🚫 | 🚫 |
| compliance | ✅(read) | 🚫 | 🚫 | 🚫 | 🚫 | ✅ | 🚫 | 🚫 | 🚫 |
| agency_owner | 🔶(own submissions, status only) | ✅(submit) | 🚫 | 🚫 | 🚫 | 🚫 | 🔶 | 🚫 | 🚫 |
| client | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 |

### Household / Members (DOB sensitive)
| Role | V | C | E | D | A | X | M | G | N |
|---|---|---|---|---|---|---|---|---|---|
| super_admin | ✅ | ✅ | ✅ | ✅ | 🚫 | ✅ | ✅ | ✅ | ✅ |
| fsa | 🔶 | ✅ | 🔶 | 🔶📝 | 🚫 | 🔶 | 🔶 | 🚫 | 🚫 |
| licensed_staff | 🔶 | ✅ | 🔶 | 🚫 | 🚫 | 🔶 | 🔶 | 🚫 | 🚫 |
| admin/ops | 🔶 | 🔶 | 🔶 | 🚫 | 🚫 | 🔶 | 🚫 | 🚫 | 🚫 |
| case_manager | 🔶(assigned) | 🚫 | 🔶 | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 |
| compliance | ✅(read) | 🚫 | 🚫 | 🚫 | 🚫 | ✅ | 🚫 | 🚫 | 🚫 |
| agency_owner | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 |
| client | 🔶(self, allowlisted) | 🚫 | 🔶(permitted contact fields) | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 |
> DOB decrypt limited to super_admin/fsa/licensed_staff/case_manager(assigned). Every DOB view 📝.

### Policy & Coverage
| Role | V | C | E | D | X | M |
|---|---|---|---|---|---|---|
| super_admin | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| fsa / licensed_staff | 🔶 | ✅ | 🔶 | 🔶(fsa)/🚫 | 🔶 | 🔶 |
| admin/ops/case_manager | 🔶 | 🔶 | 🔶 | 🚫 | 🔶 | 🚫 |
| compliance | ✅(read) | 🚫 | 🚫 | 🚫 | ✅ | 🚫 |
| agency_owner | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 |
| client | 🔶(permitted review info only) | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 |
> is_security policy: securities fields never shown to client/agency_owner; no automated M by anyone.

### Financial Review
| Role | V | C | E | D | X | M |
|---|---|---|---|---|---|---|
| super_admin | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| fsa | 🔶 | ✅ | 🔶 | 🔶 | 🔶 | 🔶 |
| licensed_staff | 🔶 | ✅ | 🔶 | 🚫 | 🔶 | 🔶 |
| admin/ops | 🔶 | 🔶(schedule) | 🔶 | 🚫 | 🚫 | 🚫 |
| compliance | ✅(read) | 🚫 | 🚫 | 🚫 | ✅ | 🚫 |
| client | 🔶(own permitted review info) | 🔶(request via schedule) | 🚫 | 🚫 | 🚫 | 🚫 |
> Review outcome cannot be saved as a "recommendation" by anyone. Securities/replacement outcomes ⤴.

### Term Conversion / Cross-Sell (identify/educate/invite only)
| Role | V | C(enroll) | E | M(educate/invite) | recommend |
|---|---|---|---|---|---|
| super_admin | ✅ | ✅ | ✅ | ✅ | 🚫 (no such action exists) |
| fsa / licensed_staff | 🔶 | 🔶 | 🔶 | 🔶 | 🚫 |
| admin/ops | 🔶 | 🚫 | 🚫 | 🚫 | 🚫 |
| compliance | ✅(read) | 🚫 | 🚫 | 🚫 | 🚫 |
| client/agency_owner | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 |
> No role has a "recommend product" action. Green-zone M only, through the gate.

### Opportunity & Pipeline
| Role | V | C | E | D | A(advance) | X | M |
|---|---|---|---|---|---|---|---|
| super_admin | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| fsa | 🔶 | ✅ | 🔶 | 🔶 | 🔶 | 🔶 | 🔶 |
| licensed_staff | 🔶 | ✅ | 🔶 | 🚫 | 🔶* | 🔶 | 🔶 |
| admin/ops/case_manager | 🔶 | 🚫 | 🔶 | 🚫 | 🚫 | 🚫 | 🚫 |
| compliance | ✅(read) | 🚫 | 🚫 | 🚫 | 🚫 | ✅ | 🚫 |
| agency_owner/client | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 |
> *securities-scope gate: staff without securities registration cannot advance is_security opps past the configured stage.

### Case Management
| Role | V | C | E | D | X | M |
|---|---|---|---|---|---|---|
| super_admin | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| fsa | 🔶 | ✅ | 🔶 | 🔶 | 🔶 | 🔶 |
| licensed_staff | 🔶 | ✅ | 🔶 | 🚫 | 🔶 | 🔶 |
| case_manager | 🔶(assigned) | 🔶 | 🔶 | 🚫 | 🔶 | 🔶(status updates) |
| admin/ops | 🔶 | 🔶 | 🔶 | 🚫 | 🔶 | 🚫 |
| compliance | ✅(read) | 🚫 | 🚫 | 🚫 | ✅ | 🚫 |
| client | 🔶(non-securities milestones, where allowed) | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 |

### Commission (+ splits config)
| Role | V | C | E | D | X | G(splits) |
|---|---|---|---|---|---|---|
| super_admin | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| fsa | 🔶 | 🔶(record) | 🔶 | 🚫 | 🔶 | 🔶(overrides) |
| licensed_staff | 🔶 | 🚫 | 🚫 | 🚫 | 🔶 | 🚫 |
| admin/ops | 🔶(reconcile) | 🔶(received) | 🔶(adjust📝) | 🚫 | 🔶 | 🚫 |
| compliance | ✅(read) | 🚫 | 🚫 | 🚫 | ✅ | 🚫 |
| agency_owner | 🔒(own attributed, if comp_disclosure) | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 |
| client | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 |
> Split defaults are assumption-flagged; any edit 📝 before/after.

### Marketing & Communications
| Role | V | C(campaign) | E | A(template) | X | M(send) | G |
|---|---|---|---|---|---|---|---|
| super_admin | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| fsa | 🔶 | 🔶 | 🔶 | 🚫 | 🔶 | 🔶 | 🚫 |
| licensed_staff | 🔶 | 🔶 | 🔶 | 🚫 | 🔶 | 🔶 | 🚫 |
| admin/ops | 🔶 | 🔶 | 🔶 | 🔶(submit) | 🔶 | 🚫 | 🔶 |
| compliance/supervisor | ✅(read) | 🚫 | 🚫 | ✅(approve) | ✅ | 🚫 | 🚫 |
| agency_owner/client | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 | 🔶(reply, consented) | 🚫 |
> Template approval = compliance/supervisor/super only. All M through the 13-step gate (`../data-guardrails.md` §5).

### Documents
| Role | V | C(upload) | E(meta) | D | X | share |
|---|---|---|---|---|---|---|
| super_admin | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| fsa/licensed_staff | 🔶 | ✅ | 🔶 | 🔶(fsa) | 🔶 | 🔶(signed URL) |
| admin/ops/case_manager | 🔶 | 🔶 | 🔶(classify) | 🚫 | 🔶 | 🔶 |
| compliance | ✅(read) | 🚫 | 🚫 | 🚫(legal hold) | ✅ | 🚫 |
| agency_owner | 🔶(agency docs) | 🔶 | 🚫 | 🚫 | 🚫 | 🚫 |
| client | 🔶(own requests) | 🔶(upload requested) | 🚫 | 🚫 | 🚫 | 🚫 |

### AI Operations
| Role | V | run | E(config) | G(prompts/models) | kill switch | A(escalation) |
|---|---|---|---|---|---|---|
| super_admin | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| fsa | 🔶 | 🔶(trigger) | 🚫 | 🚫 | 🔶(enable/disable) | 🔶 |
| licensed_staff | 🔶 | 🚫 | 🚫 | 🚫 | 🚫 | 🔶 |
| compliance/supervisor | ✅(read runs/escalations) | 🚫 | 🚫 | 🚫 | 🚫 | 🔶(review) |
| others | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 |
> Compliance Guardrail agent cannot be disabled without super + second factor 📝.

### Compliance (records/oversight)
| Role | V | A(approve) | E(exception) | X | incident |
|---|---|---|---|---|---|
| super_admin | ✅ | ✅ | ✅ | ✅ | ✅ |
| compliance | ✅ | ✅ | 🔶 | ✅ | 🔶 |
| supervisor | ✅ | ✅ | 🔶 | ✅ | 🔶 |
| fsa | 🔶(own firewall/licenses/consent/dnc/exceptions) | 🚫 | 🚫 | 🔶 | 🚫 |
| others | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 |
> Exception override requires permission + reason + 📝.

### System / Platform admin
| Role | users/roles/permissions | products/carriers/states | integrations | feature flags | jobs | audit | retention | security | backups |
|---|---|---|---|---|---|---|---|---|---|
| super_admin | ✅N | ✅N | ✅N | ✅N | ✅N | ✅V/X | ✅N | ✅N | ✅N |
| admin | 🔶(support: invite/reset/unlock) | 🔶(operational config) | 🚫 | 🚫 | 🔶(view) | 🔶(view) | 🚫 | 🚫 | 🚫 |
| compliance | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 | ✅(view/export) | 🔶(retention view) | 🚫 | 🚫 |
| all others | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 |
> Impersonation (super/admin) → persistent banner + 📝. All platform actions 📝.

---

## 4. Portal access summary
| Portal | Roles with access |
|---|---|
| FSA `/app` | fsa, licensed_staff (super_admin via switcher) |
| Admin `/admin` | admin, ops, case_manager, super_admin |
| Compliance `/compliance` | compliance, supervisor, super_admin |
| Partner `/partner` | agency_owner |
| Client `/client` | client |
| Super `/super` | super_admin |

## 5. Enforcement checklist (must pass CI)
- [ ] Every action verb enforced server-side (never client-only); RLS denies out-of-scope rows.
- [ ] Securities-scope gate blocks securities create/advance/communicate for unlicensed actors; 📝 firewall event.
- [ ] Comp-disclosure gate hides partner commissions unless flag on (nav hidden + 403 on deep link).
- [ ] Consent/quiet-hours/DNC enforced at send time for every M, every role.
- [ ] Client/partner reads column-allowlisted (no securities/advice/other-party fields).
- [ ] Template approval limited to compliance/supervisor/super.
- [ ] Compliance Guardrail agent undisableable without super + second factor.
- [ ] Every privileged/admin/impersonation action audited.
- [ ] Removing a permission at `/super/permissions` immediately hides nav + 403s deep links.
