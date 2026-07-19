# FSOS Part 5 — Missing-Requirement Analysis

> Independent gap audit of the entire FSOS concept: what was absent, incomplete, duplicated, disconnected, unsafe, or underdefined — and where each is now resolved. This is the "don't wait for the user to find the gap" deliverable. Severity: **S1** blocks launch · **S2** blocks professional launch · **S3** operational · **S4** future. Status: **Resolved** (specified in Parts 1–4) · **Config** (ships as labeled editable default) · **External** (depends on Farmers/FFS/legal, not buildable in FSOS).

---

## A. Structural gaps (pages/modules that would have been forgotten)
| # | Gap | Sev | Resolution |
|---|---|---|---|
| A1 | Financial Review layer absent — the connective spine (Agency→Referral→Household→**Review**→Opportunity) had no home | S1 | Resolved — OS-06 Financial Review (Part 1/2), WF-2 (Part 3) |
| A2 | Case Management buried, not a module | S2 | Resolved — OS-10 promoted (NIGO-free) |
| A3 | Notifications system missing (every archetype "notifies" but nowhere to land) | S1 | Resolved — notification center + `notifications` table + prefs (build-order gap #1) |
| A4 | Global search / command palette named in shell, no backend | S2 | Resolved — `api/search` RLS-scoped + ⌘K (gap #2) |
| A5 | Error boundary + real error logging | S1 | Resolved — `app/error.tsx`, `/super/errors`, logger (gap #3) |
| A6 | Consent token pages (opt-out link target) | S1 | Resolved — public `/consent` + `/consent/preferences` (gap #10) |
| A7 | Empty-catalog guard (opportunity/policy create with no products) | S2 | Resolved — guided block → `/super/products` (gap #11) |
| A8 | Super Admin platform controls (users/roles/flags/jobs/backups) | S1 | Resolved — P-6 portal (Part 1/2) |
| A9 | Reviews-due / renewals / conversions "due" surfaces | S2 | Resolved — `/reviews/due`, `/policies/renewals`, conversion tiers |

## B. Connection gaps (features that existed but didn't link)
| # | Gap | Sev | Resolution |
|---|---|---|---|
| B1 | Detail pages risking dead ends | S2 | Resolved — anti-dead-end related-record link sets per entity (Part 1 §5) |
| B2 | Referral→household→opportunity→case→commission attribution chain | S1 | Resolved — WF-1 carries `referring_agency_id` through to splits |
| B3 | Review outcome → opportunity origination not wired | S2 | Resolved — `/reviews/[id]/outcome` creates opportunities (WF-2) |
| B4 | Placement → commission record not automatic | S2 | Resolved — placed_issued prompts commission row (WF-1/WF-7) |
| B5 | Inbound STOP → consent/DNC not synced before next send | S1 | Resolved — `webhooks/twilio` updates before dispatch (WF-5/WF-9, gap #6) |

## C. Workflow gaps (automations that would stop halfway)
| # | Gap | Sev | Resolution |
|---|---|---|---|
| C1 | Jobs without idempotency → double-sends on retry | S1 | Resolved — idempotency keys on all jobs + `api/comms/send` (gap #5) |
| C2 | Blocked sends silently dropped | S1 | Resolved — blocks logged + escalated, never dropped (WF-5) |
| C3 | Agent low-confidence / judgment path undefined | S1 | Resolved — WF-8 escalation → `/app/ai/escalations` |
| C4 | Import with no rollback | S2 | Resolved — WF-11 preview + rollback token (gap in ChatGPT prompt, now real) |
| C5 | No-show / missed appointment handling | S3 | Resolved — reschedule + reminder (WF-2) |
| C6 | Dormant-agency reactivation | S3 | Resolved — WF-6 |

## D. Safety / compliance gaps (the dangerous ones)
| # | Gap | Sev | Resolution |
|---|---|---|---|
| D1 | AI could produce a product recommendation | S1 | Resolved — red-line guardrail hard-block; no "recommend" action exists (CLAUDE.md §2.2, WF-8) |
| D2 | Securities data leaking into automation/portals | S1 | Resolved — firewall: `is_security` excluded from sends; client/partner column allowlist (§2.1) |
| D3 | Sends bypassing consent/quiet-hours/DNC | S1 | Resolved — 7-step dispatcher gate at send time (WF-5/WF-9) |
| D4 | Audit trail incomplete | S1 | Resolved — append-only `audit_log` on every mutation/send/block/AI action (Part 4 taxonomy) |
| D5 | Permission bypass via deep link | S1 | Resolved — middleware coarse gate + RLS + rbac; 403 not blank (Part 1/4) |
| D6 | Invented Farmers splits/windows/products/APIs | S1 | Config — assumption-flagged editable defaults + "verify" badge; no invented integrations |
| D7 | Incident/breach response undefined | S2 | Resolved — WF-10 + `/compliance/incidents` (dates = compliance floor) |
| D8 | Impersonation without trace | S2 | Resolved — banner + audit (gap #12) |
| D9 | DOB (only sensitive PII) unprotected | S1 | Resolved — pgcrypto column encryption + decrypt-role limit + view audit |
| D10 | Securities suitability/Reg BI treated as FSOS function | S1 | External — pointer only (`ffs_case_ref`); real suitability in FFS-supervised systems |

## E. Data-integrity gaps
| # | Gap | Sev | Resolution |
|---|---|---|---|
| E1 | Duplicate households/referrals | S2 | Resolved — dedupe on email/phone at intake/convert; merge tool |
| E2 | Money as float | S2 | Resolved — integer cents / numeric(,2) discipline (data-guardrails) |
| E3 | Split %s not summing to 100 | S2 | Resolved — CHECK constraint + validation |
| E4 | Seed/demo data to exercise empty vs populated states | S2 | Resolved — seed script (gap #7) |
| E5 | Backup + tested restore | S1 | Resolved — `backup-verify` + `/super/backups` + independent pg_dump (gap #8) |

## F. Security gaps (standard enterprise controls)
| # | Gap | Sev | Resolution |
|---|---|---|---|
| F1 | Rate limiting + bot protection on public/auth | S1 | Resolved — middleware + captcha on public forms (gap #4) |
| F2 | MFA / session revocation | S1 | Resolved — Supabase MFA; device/session revoke (middleware-auth) |
| F3 | File-upload security (scan, signed URLs) | S1 | Resolved — Document OS + Storage integration |
| F4 | Secrets never displayed | S1 | Resolved — A12 integration archetype |
| F5 | Retention + legal hold interplay | S2 | Resolved — ≥7yr retention + legal-hold gate on delete |

## G. Underdefined items now specified
| # | Item | Resolution |
|---|---|---|
| G1 | What "done" means per page | Definition of Done (archetypes) + 40-point standard |
| G2 | Build order / dependencies | build-order.md (Foundation→P0→P1→P2→P3) |
| G3 | Who sees what | RBAC matrix (Part 4) + override gates |
| G4 | Screen→data wiring | Data & API map (Part 4) + completeness rule |
| G5 | Alternate/recovery paths | Part 3 (every workflow: happy/empty/error/unauth/dup/cancel/retry/recovery) |

## H. Scope corrections applied
| # | Correction | Rationale |
|---|---|---|
| H1 | NIGO removed entirely | Separate project; not in FSOS scope (user directive) |
| H2 | Billing → P3 placeholder | Internal single-operator system, not multi-tenant SaaS |
| H3 | Super Admin kept as distinct blueprint section | Prevent forgotten platform functionality (may merge to a role at build) |

## I. Residual external dependencies (NOT buildable inside FSOS — flag before launch)
| # | Item | Owner |
|---|---|---|
| I1 | Actual FSA↔agency commission splits | FSA contract / Farmers — replace config default |
| I2 | FNWL term-conversion window + eligible products | ICC25-FTL contract / FNWL SERFF filing — replace config default |
| I3 | Whether any Farmers/FFS API exists for policy/commission data | Farmers/FFS — until verified, manual/CSV fallback |
| I4 | What FSOS may store re: securities clients | FFS compliance sign-off (written) |
| I5 | WISP, Reg S-P incident plan, TCPA/Texas SB 140 posture | Counsel / compliance review |
| I6 | Reg BI "recommendation" boundary confirmation for the green-zone templates | FFS compliance review of approved templates |

---

## Summary
- **All S1/S2 structural, connection, workflow, safety, data, and security gaps are Resolved in Parts 1–4.**
- **Six items are Config** (assumption-flagged editable defaults) rather than invented facts.
- **Six items are External** (I1–I6) — they gate go-live but are business/legal confirmations, not code. Surface them to the FSA/FFS/counsel before launch; the system is built to accept the real values without redesign.
