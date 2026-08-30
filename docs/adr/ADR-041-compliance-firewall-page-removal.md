# ADR-041 — Compliance Firewall Page Removal

**Status:** Accepted
**Date:** 2026-08-30
**Owner:** FSOS Engineering (authorized by the platform owner / licensed FSA)
**Relates to:** [ADR-004 — Securities Firewall](./ADR-004-securities-firewall.md) (unchanged),
[ADR-040 — Compliance Intelligence Excision](./ADR-040-compliance-intelligence-excision.md) (procedure followed)

## Context

FSOS carried two read-only ledger pages over the `compliance_events` table:

| Route | File | Portal / roles | View |
|---|---|---|---|
| `/app/compliance/firewall` | `(fsa)/app/compliance/firewall/page.tsx` | FSA — `fsa`, `licensed_staff`, `super_admin` | "Firewall & Comms Blocks" — every `compliance_events` row |
| `/compliance/firewall` | `(compliance)/compliance/firewall/page.tsx` | Compliance — `compliance`, `supervisor`, `super_admin` | "Securities Firewall" — rows where `kind = 'firewall'`, limit 300 |

Both were pure readers. Neither wrote a row, enforced a control, or was called by
any API route, job, or service.

The platform owner directed that the Compliance Firewall be removed from FSOS.

**The decisive distinction.** The word "firewall" names four different things in
this repository, and only the first is removed here:

| Thing | Location | Disposition |
|---|---|---|
| The two ledger **pages** above | `(fsa)/app/compliance/firewall/**`, `(compliance)/compliance/firewall/**` | **Removed** |
| The securities firewall **guardrail** (Guardrail 1) | `src/lib/compliance/firewall.ts` | **Retained, untouched** |
| The `compliance_events` **audit ledger** and its writers | migrations, 9 writers across API routes + `lib/comms/escalation.ts` | **Retained, untouched** |
| Unrelated uses of the word | `042_legacy_customer_pii_firewall.sql`, `tests/booking-starturl-firewall.test.mjs` | **Retained, untouched** |

## Decision

1. **The two Compliance Firewall pages are removed.** Both routes now return a
   natural 404 — no redirect, no rewrite, no placeholder (the ADR-040 rule).
2. **The securities firewall guardrail is untouched.** `src/lib/compliance/firewall.ts`
   keeps its full API and every one of its call sites: the eight guarded write routes
   (`cases`, `commissions/[id]`, `commissions/splits`, `opportunities`, `policies`,
   `referrals/[id]/convert`, `reviews/[id]/outcome`, `social/content`) and
   `src/lib/social/precheck.ts`.
3. **No migration was written.** `compliance_events` keeps every row, index, RLS
   policy, and grant, per `docs/legacy-port.md:127` — *"Never drop a legacy table …
   Retire UI and routes only."* Every writer to the table still writes.
4. **Navigation and inbound links were refactored, not orphaned.** No surface links
   to a route that no longer exists, and no metric was silently dropped.
5. **A standing regression guard was added** — `tests/compliance-firewall-page-removed.test.mjs`
   — which fails if the pages return, if a dangling link appears, or if the
   *guardrail* is mistaken for the page and deleted.

## Why this does not weaken ADR-004

ADR-004 mandates three controls: the write-time payload assertion, the
`is_security` hard gate in the communications dispatcher and the AI action
validator, and the purple firewall marker in the UI. **All three are untouched.**
ADR-004 never mandated a dedicated events page; it mandated that securities
substance never be stored and that securities records never be auto-sent. Those
gates run in `lib/compliance/firewall.ts`, `lib/comms/gate.ts`, and
`lib/compliance/guardrail.ts`, none of which this change modifies.

Nothing stopped being *recorded*. Every block still writes both a
`compliance_events` row and an append-only `audit_log` entry
(`firewall.blocked` / `comms.blocked`).

## Where the evidence is read now

The removed pages were the only surfaces dedicated to this data, but not the only
surfaces carrying it. Both audiences retain a read path:

| Audience | Removed | Surviving equivalent | Coverage |
|---|---|---|---|
| FSA (`/app`) | `/app/compliance/firewall` | **`/app/executive/alerts`** | Same `compliance_events` table, same newest-first ordering, *broader* (all kinds, not just firewall), with a `blocked` badge on `kind='firewall'` and `lost` on `comms_blocked`, plus owner-only row deletion |
| Compliance / supervisor (`/compliance`) | `/compliance/firewall` | **`/compliance/audit`** | The append-only, tamper-evident `audit_log`, which records `firewall.blocked` and `comms.blocked` for every block |

A third FSA surface, `/app/ai/escalations`, already carried the same data before this
change: its "Recent compliance events" panel (`src/components/app/EscalationList.tsx`)
renders the 25 most recent `compliance_events` with a **dedicated `blocked_step`
column** plus kind, channel, reason and time. The removed pages were genuinely
redundant readers.

**Accepted loss — one field.** `recipient` is the only column the removed FSA ledger
displayed that no surviving surface renders. `/app/ai/escalations` selects it
(`page.tsx`) but `EscalationList` does not put it in the table, and
`/app/executive/alerts` does not select it at all. Recipient-level detail for a
blocked send remains available in the communications console and the message
timeline. No stored row, enforcement path, or audit record is lost — `recipient` is
still written to `compliance_events` on every block, only no longer surfaced in a
compliance-labelled list.

## Change inventory

**Deleted**
- `src/app/(fsa)/app/compliance/firewall/page.tsx`
- `src/app/(fsa)/app/compliance/firewall/loading.tsx`
- `src/app/(compliance)/compliance/firewall/page.tsx`

**Navigation** — `src/lib/workspaces/registry.ts`
- Workspace `compliance-fsa`: nav item dropped; description → "Consent, DNC, and licenses."
- Workspace `comp-consent`: label "Consent & Firewall" → "Consent"; `'/compliance/firewall'`
  dropped from `match`; nav item dropped; description → "Consent ledger."

**Inbound links**
| File | Change | Why |
|---|---|---|
| `(fsa)/app/compliance/page.tsx` | "Firewall events" tile → `/app/executive/alerts` | Same dataset; the metric and the anti-dead-end rule both survive |
| `(compliance)/compliance/page.tsx` | "Firewall events" tile → "Audit log" → `/compliance/audit` | The surviving supervisory evidence surface |
| `(fsa)/app/cases/page.tsx` | "Securities-flagged" tile: `href` dropped, hint `FFS-managed · firewall` → `FFS-managed` | The tile counts flagged *records*; the ledger showed *block events* — it was never the right destination, and no securities-filtered list exists. `href` is optional on `PageStat`/`MetricCard` |
| `(fsa)/app/opportunities/page.tsx` | same | same |
| `(fsa)/app/conversions/page.tsx` | "Firewall →" link removed from the "Compliance & firewall" panel; orphaned `ArrowRight` import dropped | The panel's substance (FFS-managed count + the exclusion policy) is still true — the firewall *policy* is unchanged |
| `(fsa)/app/settings/page.tsx` | Compliance-center quick-link copy "Consent, DNC, licenses, and the firewall." → "Consent, DNC, and licenses." | Not a broken href — stale copy naming a destination the compliance center no longer offers. Now matches the workspace description verbatim |

**Tests**
- `tests/workspace-registry.test.mjs` — `'/compliance/firewall'` dropped from `LEGACY_NAV.compliance.hrefs`
- `tests/compliance-firewall-page-removed.test.mjs` — **new**, 14 assertions

**Docs** — `docs/sitemap.md`, `docs/routes.md` (both the FSA and P-3 listings),
`docs/redesign/route-workspace-matrix.md` (the workspace row and the workspace-21
subtree), `docs/specs/comms-ai-compliance.md`, `docs/adr/README.md`, and `PRODUCT.md`
(the `/compliance/*` portal-capability row no longer claims "firewall monitoring")

**Deliberately left alone** — `docs/specs/rbac-matrix.md:176` (`fsa | 🔶(own
firewall/licenses/consent/dnc/exceptions)`) is a *capability* matrix, not a route
inventory. The FSA's capability to view its own firewall events is retained — it moved
to `/app/executive/alerts`, it was not withdrawn. `INTELLIGENCE_EXCISION_LEDGER.md` is
append-only by its own header rule and records a different feature's excision (ADR-040);
this ADR is the record for this one.

**Explicitly untouched** — `src/lib/compliance/firewall.ts` · `src/lib/compliance/guardrail.ts` ·
`src/components/ui/securities.tsx` (33 consumers) · the `blocked` / `security` badge
variants · the `compliance_events` table, its RLS and its migrations · every writer to
it · `src/lib/audit/log.ts` · `src/lib/services/eventDeletion.ts` and
`api/compliance/events/[id]` (consumed by `/app/executive/alerts`, not by the removed
pages) · every other compliance surface (`consent`, `dnc`, `licenses`, `attestations`,
`audit`, `communications`, `incidents`, `legal-holds`, `policies`) ·
`tests/rls-firewall.test.mjs` · `tests/firewall-write-scan.test.mjs` ·
`tests/booking-starturl-firewall.test.mjs`

## Alternatives Considered

- **Remove only the FSA page, keep the supervisory twin.** Rejected by the platform
  owner, who directed that both be removed. The compliance risk this option was meant
  to address — losing the supervisory demonstration that the firewall works — is
  answered by `/compliance/audit`, which reads the append-only `audit_log` where every
  `firewall.blocked` is recorded.
- **Redirect both routes to their surviving equivalents.** Rejected: ADR-040 set the
  house rule that a removed route returns a natural 404, and a redirect would leave the
  removed feature half-alive in bookmarks and link checkers.
- **Drop the `compliance_events` table.** Rejected: `docs/legacy-port.md:127` forbids it,
  the rows are retention-relevant supervisory records, and nine writers and five other
  readers still depend on the table.
- **Drop the "Securities-flagged" tiles entirely from Cases and Opportunities.**
  Rejected: the count is a real, useful signal computed from data the page already
  loaded. Only its (always slightly wrong) destination was removed.

## Consequences

**Positive**
- One fewer duplicate read surface over `compliance_events`; the FSA now has a single
  alerts destination instead of two overlapping ledgers.
- No dangling navigation, no dead-end tile, no orphaned route.
- The page/guardrail distinction is now pinned by a test instead of by convention.

**Negative / trade-offs**
- `recipient` on a blocked send is no longer visible in a compliance-labelled list;
  it must be read from the communications console or the message timeline. (Surfacing
  it in `EscalationList`, which already loads the field, would close this in one line
  if it proves to matter operationally.)
- The supervisory view of firewall blocks is now the general audit log rather than a
  purpose-built, pre-filtered page — one extra step of interpretation for a supervisor.

## Related Documents
- `docs/data-guardrails.md` §3 (Guardrail 1) · `docs/specs/comms-ai-compliance.md`
- `docs/legacy-port.md:127` (never drop a legacy table) · `.claude/skills/fsos-security-audit`
