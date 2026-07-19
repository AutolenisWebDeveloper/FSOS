# PRODUCT.md — FSOS

> Product context for the Impeccable design workflow. Captures what FSOS is, who
> uses it, and the register/constraints every design decision must serve. Pairs
> with `DESIGN.md` (the documented design system) and the authoritative build
> contract in `CLAUDE.md`.

## Register

**Product.** Design SERVES the task here. FSOS is an authenticated, information-dense
operator tool — a financial-services operating system, not a marketing surface. The
bar is *earned familiarity*: a licensed specialist should sit down and trust it the
way they trust Linear, Stripe, or a Bloomberg Terminal, never pausing at a subtly-off
control. Consistency beats surprise; the interface disappears into the work.

- **Platform:** web (Next.js 14 App Router, desktop-first, responsive to tablet/mobile).
- **Density:** high. Tables of many rows, panels of many labels, KPI grids. Operators
  want information, not whitespace.
- **Voice:** precise, institutional, calm. Financial expertise and operational control.

## One-liner

A private, internal operating system for a **Farmers Financial Services Agent (FSA)** —
a life- and securities-licensed specialist in McKinney, TX who partners with Farmers
agency owners to bring life insurance (FNWL) and financial products (through FFS) to
those agencies' existing clients. A **B2B2C referral/wholesale model**.

## Who uses it (six portals + a public surface)

| Portal | Route group | User | Primary jobs |
|---|---|---|---|
| **FSA** | `/app/*` | The FSA + delegated licensed staff | Run the whole book: agencies, referrals, households, reviews, pipeline, cases, commissions, comms, AI ops |
| **Admin / Back-office** | `/admin/*` | Assistants, case managers, ops | Data imports, document verification, support requests, user management |
| **Compliance & Supervisory** | `/compliance/*` | Reviewers / supervisors | Firewall monitoring, consent, attestations, audit, legal holds — *supplemental to FFS, never a replacement* |
| **Agency-Owner** | `/partner/*` | Farmers agency owners | Refer clients, watch production/commissions, training, materials |
| **Client-facing** | `/client/*` | End clients | Intake, consent, case status, appointments, education — *non-securities, non-advice only* |
| **Super Admin** | `/super/*` | Platform owner | AI policies + kill switch, config defaults, integrations, roles, health |
| **Public** | `/*` | Unauthenticated | Login/MFA, agency referral links, client upload/forms, disclosures |

## The aggregate root (what the data model is *about*)

The spine is **Agency Partnership → Referral → Household → (Financial) Review →
Opportunity → Case → Commission.** The aggregate root is the **Agency-Owner
Partnership**, not a generic contact or deal. FSOS is emphatically *not* a generic
contact-and-deal CRM, and the UI must reflect that: an agency owner is the top of
every drill-down, and the **Financial Review** is a first-class layer where
opportunities originate.

## The three guardrails (they shape the UI, not just the backend)

These are the product's identity. The design must make them **visible**, not hide them.

1. **Securities firewall.** FSOS is not a broker-dealer system of record. Any record
   flagged `is_security` is excluded from the automated comms engine and carries a
   **purple "FFS-managed" marker** + a purple detail banner. The firewall is a design
   element, not an invisible backend rule.
2. **AI green-zone / red-line.** The autonomous AI may identify, educate, invite,
   schedule, remind, follow up, draft, assemble, log — never make an individualized
   product/investment/replacement recommendation. Every client-facing message passes a
   **Compliance Guardrail** validator before dispatch; failures are hard-blocked and
   escalated to the human FSA.
3. **No invented Farmers data.** Commission splits, conversion windows, product
   availability, carrier rules are not publicly documented. They ship as editable
   config defaults flagged `is_assumption`, each rendering a **gold "config default —
   verify" badge**. Never a hard-coded fact.

The **Compliance Intelligence** module (`/app/compliance/intelligence`) is the one
authorized exception: a retrieval-grounded drafting/analysis aid, still firewall-bound,
every conclusion cited to an uploaded library passage.

## Primary user goals (what a screen exists to accelerate)

- **Triage first.** The FSA opens the app to answer "what needs me now?" — escalations,
  overdue reviews, at-risk policies, NIGO correspondence, referrals awaiting action.
- **Work the spine.** Move records forward: qualify a referral → build a household →
  run a review → open an opportunity → manage the case → reconcile the commission.
- **Engage compliantly.** Run campaigns, sequences, and 1:1 comms that always clear
  consent, quiet hours, DNC, and the firewall.
- **Supervise & prove.** Compliance/super users need audit trails, attestations, and a
  kill switch. Every mutation writes an append-only `audit_log`.

## Non-goals / scope guardrails (do not design for these)

- Not a general CRM; not a broker-dealer system of record.
- No NIGO automation across the general book (Case Management stays NIGO-free); NIGO
  lives only in the isolated Compliance Intelligence module.
- Billing/subscription (`/super/billing`) is a placeholder only.
- **This redesign preserves all backend logic, APIs, schema, auth, business rules,
  workflows, and integrations.** Frontend architecture, UI, UX, consistency,
  responsiveness, accessibility only.

## Design objective (this initiative)

Make 241 pages across 7 surfaces read as **one cohesive enterprise operating system** —
the product a Fortune-500 bank, broker-dealer, or wealth firm would run internally.
Inspiration: Stripe Dashboard, Mercury, Ramp, Bloomberg Terminal, Linear, Notion,
Vercel. Institutional, trustworthy, intelligent, efficient. Explicitly avoid
glassmorphism, neumorphism, consumer styling, oversized radii, heavy shadows,
decorative gradients, marketing aesthetics. The signature look is the **dark navy shell
+ light content canvas, DM Sans/Mono, signature gold, visible securities firewall** —
carried forward, sharpened, and applied uniformly.
