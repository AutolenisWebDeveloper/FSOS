---
name: fsos-code-review
description: Use for independent review of Voice Agent work after a stage or a large change. Reviews only; does not build. Compares the implementation with the plan, checklist, repo map and FSOS architecture.
---

# FSOS Voice code review

Review, don't build. Don't trust the stage report; verify against code and re-run tests.

## Compare
Implementation ↔ `docs/voice/voice-agent-plan.md` ↔ `docs/voice/voice-agent-build-checklist.md` (stage + universal definition of done) ↔ `docs/voice/repo-map.md` ↔ root `CLAUDE.md` rules.

## Look for
- Missing or partially met requirements; contradictory implementation
- Any bypass: outbound path outside the dispatch chokepoint (`src/lib/messaging.ts`), model call outside `runGateway()`, tool outside the policy engine, missing audit, model-controlled authorization
- Wrong tool permissions, assurance levels or consent basis
- Data above assurance reaching the model; keypad digits, PINs or PII in context or logs
- New tables without FSOS-pattern RLS (default-deny, role-based SELECT, service-role writes after `requireApiRole`); migrations without a tested rollback; edited existing migrations; deleted data; a second consent store or audit log
- Prohibited tools, advice wording, product claims, AI advancing an opportunity stage, NIGO
- Duplicate services, components, utilities or state; dead paths
- Untested failure paths; mocked tests reported as live
- UI not connected to the real backend; mock data left; missing loading/empty/error/degraded/permission-denied states or keyboard access (dark mode only if the owner decides to build it (owner decision pending, C20))
- Phase bleed; regressions in earlier stages
- Code that works but breaks the architecture invariants

## Output
Findings ranked by severity (P0 blocks the stage, P1 must fix before next stage, P2 later), each with file:line, requirement violated and a concrete fix. Then a verification table with CODE-, TEST-, INTEGRATION-, BROWSER-, COMPLIANCE-VERIFIED or NOT VERIFIED per checklist item. Any PASS you could not reproduce is NOT VERIFIED. "No material findings" is a valid result.
