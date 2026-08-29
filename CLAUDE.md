# CLAUDE.md — FSOS Engineering Guide

Read this file at the start of each Claude Code session.

This guide exists to help Claude Code improve FSOS quickly, intelligently, and completely. It is
not a regulatory manual, a frozen contract, a backlog, or a reason to block authorized work. The
current request defines the scope. The repository provides the implementation truth. Relevant
documentation and ADRs provide context when the task touches them.

---

## 1. Product objective

Build and continuously elevate FSOS into a premium, enterprise-grade Financial Services Operating
System for a Farmers Financial Services Agent in McKinney, Texas, who partners with Farmers agency
owners in a B2B2C operating model supporting life insurance and financial-services opportunities.

FSOS supports the operating relationship:

`Agency Partnership → Referral → Household → Review → Opportunity → Case → Commission`

The Agency Partnership is the primary organizing context. FSOS includes CRM, communications,
campaigns, appointments, referrals, opportunities, cases, documents, reporting, automation, AI,
and related operating capabilities. Improve the existing product instead of turning it into a
generic CRM or creating separate systems for functions FSOS already owns.

The product standard is a modern Fortune 500 fintech experience: credible, polished, fast,
reliable, secure, accessible, scalable, maintainable, and operationally clear across the frontend,
backend, database, integrations, automations, and user experience.

---

## 2. Technology stack

Confirm exact versions and scripts from `package.json` and the lockfile. Do not hard-code dependency
versions in this guide.

- **Next.js** App Router with strict **TypeScript**
- **Supabase** for Postgres, Auth, Row-Level Security, Storage, and applicable platform services
- **Vercel** for hosting and scheduled jobs
- **Tailwind CSS** and **shadcn/ui**, with visuals resolved through the existing design tokens
- **Twilio** for SMS and **Resend** for email
- A **model-agnostic AI gateway** for model access; product features use the gateway rather than
  calling model-provider SDKs directly from routes or components

Extend the stack already implemented in the repository. Introduce a new dependency or provider only
when the requested outcome requires it and the existing architecture does not already solve the
problem cleanly.

---

## 3. How Claude Code should operate

Use the highest available reasoning level and the strongest relevant engineering, planning,
frontend, debugging, testing, review, and verification capabilities.

For non-trivial work:

1. Understand the requested business outcome.
2. Inspect the actual repository before deciding what must change.
3. Trace the affected user journey, data flow, services, integrations, and dependencies.
4. Create a concise implementation plan when the work has multiple steps.
5. Implement the complete requested outcome at the correct architectural layers.
6. Review the work critically for defects, duplication, security issues, usability gaps, and
   unfinished behavior.
7. Test, debug, and verify the result before reporting completion.

Discover installed skills dynamically and use the relevant ones. Do not hard-code a skill count.
Skills improve execution but do not replace repository inspection, principal-level judgment,
working code, tests, or direct verification.

Do not manufacture approval gates, restrictions, or blockers from vague or stale prose. When
documentation conflicts with current code or the user’s authorized objective, investigate the
conflict and use the narrowest sound resolution that delivers the requested result without damaging
the existing system.

Complete implementation requests with working functionality. Do not substitute a plan, mockup,
placeholder, partial scaffold, or general advice unless that is what the user requested.

---

## 4. Skill orchestration

Skills are execution capabilities. Use them to improve analysis, planning, implementation, review,
testing, and design—not to invent restrictions or avoid authorized work.

At the start of a task, inspect `.claude/skills/` and discover the skills currently installed. Do
not rely on a hard-coded total. Load the smallest complete set needed for the task, and combine
skills when the work spans multiple domains.

### Default workflow for non-trivial work

1. **Understand:** `using-superpowers` plus the relevant FSOS, database, or integration skill.
2. **Plan:** `brainstorming` when real design exploration is needed, then `writing-plans`.
3. **Implement:** `executing-plans`, `test-driven-development`, `fsos-testing`, and the relevant
   engineering or domain skills.
4. **Debug:** `systematic-debugging` for defects, failed tests, or unexpected behavior.
5. **Design and polish:** `frontend-design` for user-facing work, followed by `impeccable`.
6. **Review and verify:** `requesting-code-review`, `receiving-code-review`, and
   `verification-before-completion`.
7. **Finish:** `finishing-a-development-branch` when branch, PR, or cleanup work is requested.

### Engineering workflow skills

| Skill | Use |
|---|---|
| `using-superpowers` | Discover and sequence the best available workflow for the task. |
| `brainstorming` | Explore requirements, product behavior, or architecture when the correct design is not yet clear. |
| `writing-plans` | Produce an executable, phased plan for multi-step changes. |
| `executing-plans` | Implement an approved plan with checkpoints and verification. |
| `subagent-driven-development` | Coordinate delegated implementation when the environment and task support it. |
| `dispatching-parallel-agents` | Run genuinely independent workstreams in parallel when authorized and available. |
| `test-driven-development` | Define expected behavior with a failing test before implementing logic. |
| `fsos-testing` | Apply FSOS test conventions: bare scripts under `tests/`, discovery through `scripts/run-tests.mjs`, `node:assert/strict`, runtime TypeScript compilation where used, and the unit/RLS split. Pair with `test-driven-development`. |
| `systematic-debugging` | Reproduce, isolate, prove, and fix the root cause of failures. |
| `verification-before-completion` | Verify the real result before claiming completion. |
| `requesting-code-review` | Perform or request a structured review of material changes. |
| `receiving-code-review` | Evaluate review feedback and apply justified corrections. |
| `finishing-a-development-branch` | Complete requested branch, commit, PR, or cleanup work after verification. |
| `using-git-worktrees` | Isolate parallel or high-risk implementation work when appropriate. |

### Database and backend skills

| Skill | Use |
|---|---|
| `supabase` | Supabase database, authentication, storage, realtime, and Edge Function work. |
| `supabase-postgres-best-practices` | Schema design, SQL, indexes, query performance, migrations, and RLS. |
| `fsos-security-audit` | Security review for authentication, authorization, data access, PII, RLS, APIs, and integrations. |

### Frontend and design skills

| Skill | Use |
|---|---|
| `frontend-design` | Information architecture, workflows, responsive UI, accessibility, hierarchy, and component design. |
| `impeccable` | Final visual, interaction, accessibility, microcopy, and product-quality refinement. |
| `farmers-brand-website` | Farmers-aligned public-site branding and presentation using approved project assets. |

### FSOS product and domain skills

| Skill | Use |
|---|---|
| `fsos-crm-workflows` | Agency partnerships, contacts, referrals, pipelines, workflows, and CRM operations. |
| `fsos-financial-planning` | FNA calculations, models, assumptions, plans, scenarios, goals, and financial-planning workflows. |
| `marketing-plan` | Campaign strategy, segmentation, cadence, channel planning, content themes, and measurement. |

### Communications and deliverability skills

| Skill | Use |
|---|---|
| `twilio-a2p-compliance` | A2P SMS configuration, consent, opt-out handling, quiet hours, sending behavior, and verification. |
| `fsos-deliverability` | Email and SMS deliverability, sending streams, reputation, suppression, and routing. |
| `fsos-dns-auth` | SPF, DKIM, DMARC, BIMI, MX, selectors, alignment, and sending-domain validation. |
| `fsos-email-template-qa` | Responsive email HTML, plaintext parts, dark mode, accessibility, client rendering, and content QA. |

### Skill development

| Skill | Use |
|---|---|
| `skill-creator` | Create, update, optimize, validate, install, or remove a project skill. |
| `writing-skills` | Author and refine skill instructions and supporting resources. |

If a listed skill is not installed, continue with the strongest available equivalent. If the
repository contains additional relevant skills, use them. Skill instructions guide execution; the
current request defines the authorized outcome.

---

## 5. Repository-first execution

Before editing:

- Read the files being changed and the code that calls them.
- Inspect `package.json` and the lockfile for the actual stack and dependency versions.
- Search for existing components, services, schemas, hooks, tables, routes, jobs, and utilities.
- Read only the documentation, ADRs, and skills relevant to the task.
- Check existing tests and establish the current behavior where practical.
- Review the working tree and preserve unrelated user-owned changes.

Prefer extending a working subsystem over creating a parallel one. FSOS should have one coherent
design system, authentication model, data-access approach, communications path, campaign engine,
AI gateway, appointment system, audit trail, and integration layer.

Keep responsibilities clear:

`UI → route or action → domain service → database or integration adapter`

- The UI presents information, state, and actions.
- Routes and actions authenticate, authorize, validate, call services, and shape responses.
- Services own business rules, workflows, state transitions, and transactions.
- Data and integration adapters own persistence and provider-specific behavior.

Use established repository conventions such as the existing Supabase access helpers, validation
schemas, shared components, design tokens, communication services, and AI gateway. Create a new
primitive only when the existing architecture does not provide a clean responsibility for it.

Apply these FSOS conventions where the current repository still establishes them:

- Put domain and workflow logic in `src/lib/services/*`, not in React components or route handlers.
- Keep routes focused on parse → authenticate/authorize → validate → call service → typed response.
- Access Supabase through `getDb()` from `@/lib/supabase/client`; do not create a module-level client.
- Parse JSON request bodies with `readJson(req)` from `@/lib/http`, then validate the result with the
  established Zod schema. Validation may occur without importing `zod` directly in the route.
- Use the existing communications dispatcher and sending services instead of creating a parallel
  messaging path.
- Before completion, run the repository-defined build, type-check, lint, and applicable test
  commands. Use the actual script names from `package.json`.

---

## 6. Principal-level engineering quality

Produce secure, maintainable, production-grade code.

- Preserve strict TypeScript and shared domain types.
- Validate untrusted input at application boundaries.
- Enforce authentication, authorization, ownership, and tenant scope on the server.
- Keep business logic out of React components and thin route handlers.
- Design database changes for existing data, deployment order, indexes, ownership, and RLS.
- Prevent duplicate execution with transactions, constraints, idempotency, or state checks where
  appropriate.
- Treat background work as durable and observable; production automation must not depend on an open
  Claude session.
- Put provider-specific code behind the existing integration services.
- Set timeouts, handle rate limits, validate external responses, and distinguish retryable failures
  from terminal failures.
- Handle partial failure without corrupting state or silently losing work.
- Keep secrets and sensitive data out of client code, logs, fixtures, and documentation.
- Use structured logs and existing audit mechanisms for important operations.
- Avoid unbounded queries, N+1 access, unnecessary client JavaScript, duplicate fetching, and
  uncontrolled retries or fan-out.

Improve nearby code when required to complete the task cleanly, but avoid unrelated rewrites.

---

## 7. Frontend and product experience

Every user-facing surface should look and behave like one premium financial-services platform.
Use `DESIGN.md`, the established design tokens, shared components, archetype layouts, Tailwind, and
shadcn/ui patterns already present in the repository.

Use the strongest available frontend-design and product-design skills to deliver:

- Clear information architecture and navigation
- Strong hierarchy, readable density, and useful decision support
- Consistent layouts, controls, tables, forms, status patterns, and terminology
- Responsive desktop, tablet, and mobile behavior
- Accessible semantics, labels, keyboard operation, focus treatment, and contrast
- Complete loading, empty, error, success, pending, disabled, and validation states
- Clear primary actions, confirmation for destructive actions, and practical recovery paths
- Server-first rendering with narrow client boundaries
- Deliberate motion, microcopy, spacing, and visual refinement

Do not leave fake controls, dead-end pages, decorative metrics, production placeholders, broken
responsive layouts, or incomplete workflow states in the requested scope.

Review the rendered interface after implementation. Inspect real pages for alignment, overflow,
responsiveness, accessibility, interaction, content quality, and consistency—not only source code.

---

## 8. A2P SMS campaign requirements

This is the only campaign-specific compliance section in this file. It applies only to automated or
bulk SMS campaigns. It does not govern email, CRM, frontend development, reporting, case management,
documents, analytics, AI features, or unrelated FSOS work.

For automated or bulk SMS campaigns:

- Use the existing FSOS/Twilio sending path.
- Send through the A2P brand, campaign, and sending number configured for FSOS.
- Verify that the recipient has the recorded SMS consent required for that campaign before sending;
  absence of an opt-out is not evidence of consent.
- Clearly identify the sender or business in the initial campaign message.
- Include the opt-out language required by the registered A2P campaign and approved template without
  duplicating it when it is already present.
- Support `STOP` and `HELP` processing and immediately suppress additional campaign SMS after an
  opt-out.
- Apply applicable DNC suppression, campaign frequency limits, and the configured recipient-local,
  state-aware quiet-hours window. FSOS may use a conservative 9:00 a.m.–8:00 p.m. marketing window
  as an internal operating setting; do not describe it as a universal legal rule.
- Fail closed when consent, sender configuration, approved template, or message content cannot be
  resolved. Log the block; do not send a blank or partial message and do not silently switch
  channels.
- Audit every campaign-SMS attempt—blocked or sent—with the actor, recipient, campaign/message,
  timestamp, consent basis, and outcome.
- Record send, delivery, failure, reply, and opt-out events in the existing communications history.
- Keep A2P configuration, consent evidence, suppression, and delivery behavior testable and
  auditable.
- Verify `STOP`, `HELP`, suppression, status callbacks, and an end-to-end test send before activating
  production campaign traffic.

These controls exist to make A2P SMS dependable. Do not generalize them into restrictions on other
FSOS features or channels.

---

## 9. Securities and AI operating boundaries

FSOS may track operational metadata showing that a securities opportunity or case exists, including
its stage, referring agency, commission-tracking fields, and a non-substantive reference to the
FFS-supervised system. FSOS is not the system of record for securities transactions and should not
store securities account numbers, order or transaction details, or suitability determinations.

The `is_security` flag applies to the securities opportunity, case, or communication—not
automatically to every interaction with that contact. Automated messages concerning securities
activity must be withheld from the general campaign engine and routed to the licensed FSA or the
appropriate FFS-supervised workflow. This boundary must not block unrelated CRM activity,
appointment communications, administrative follow-up, or non-securities service messages.

AI may identify opportunities, provide general education, invite, schedule, remind, follow up,
support consented campaigns, summarize information, and draft internal material. AI must not
independently make an individualized product, policy, investment, replacement, or allocation
recommendation or a suitability or best-interest determination. Requests requiring those judgments
must be escalated to the licensed FSA.

AI-generated client-facing communications must pass the existing validation and dispatch path before
sending. The validator should evaluate the proposed message and its context rather than broadly
disabling unrelated communications for the entire contact.

---

## 10. Testing and debugging

Use the repository’s actual test architecture. Confirm how tests are discovered before relying on a
green result. If FSOS still uses `scripts/run-tests.mjs`, list the discovered tests and verify that
new or renamed test files appear in the appropriate suite.

Test the behavior changed by the task, including applicable validation, authorization, data access,
state transitions, background jobs, integrations, retries, idempotency, failure recovery,
accessibility, responsiveness, and user journeys.

When fixing a defect:

1. Reproduce it.
2. Establish the expected behavior.
3. Trace the earliest point where actual behavior diverges.
4. Prove the root cause.
5. Add a regression test when practical.
6. Fix the correct layer.
7. Re-run the original scenario and adjacent behavior.

Do not conceal a defect with arbitrary delays, retries, casts, broad exception handling, or by
weakening a legitimate test.

---

## 11. Verification before completion

Run the checks applicable to the change. Use scripts exactly as defined by the current repository,
including targeted tests, relevant suites, type checking, linting, builds, migration validation,
and manual end-to-end review.

Before reporting completion, confirm that:

- The requested outcome works end to end.
- Existing architecture was reused where appropriate.
- Relevant permissions, validation, failure paths, and data behavior were verified.
- The rendered UI was reviewed when the task changed a user-facing surface.
- No debug code, secrets, dead code, fake production data, or unfinished placeholders remain in
  scope.
- Unrelated files and user changes were preserved.
- Documentation was updated only where the implemented behavior or architecture requires it.

Report only checks that actually ran and their real results. If environment access prevents a
check, identify the exact unverified item without presenting it as complete.

---

## 12. Completion report

End material tasks with a concise factual handoff:

- What was implemented
- Files changed
- Tests and checks run, with actual results
- Migrations, environment variables, or deployment actions required
- Assumptions made
- Known limitations or blocked verification

Never present planned work as completed work.

---

## 13. Relevant project references

Load these only when the current task needs them:

- `PRODUCT.md` — product identity and operating model
- `DESIGN.md` — design system and interface standards
- `docs/routes.md` and `docs/sitemap.md` — route structure
- `docs/specs/rbac-matrix.md` — role and access context
- `docs/adr/` — architectural rationale for affected systems
- `.claude/skills/` — specialized execution workflows
- `twilio-a2p-compliance` and the current SMS implementation — A2P SMS campaign work only

Treat repository behavior as evidence, documentation as context, and the current authorized request
as the outcome to deliver.
