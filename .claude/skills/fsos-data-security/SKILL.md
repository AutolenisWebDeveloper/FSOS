---
name: fsos-data-security
description: Use for any Voice Agent change touching data, schemas, migrations, secrets, logs, webhooks, exports, recordings or roles. Row-level security, PII handling and threat modeling.
---

# FSOS data security

## Enforce
- Row-level security on every new table in the FSOS pattern (repo-map §6): default-deny, role-based SELECT via `has_role()` / `current_user_agencies()`, writes only through the service role (`getDb()`) after `requireApiRole`. FSOS is single-tenant (one FSA practice) and has no agency JWT claim; agency owners are partners scoped through `user_agencies`. Tests (the RLS set, `npm run test:rls`) prove other roles and other partner agencies can't read.
- Dedicated least-privilege orchestrator role limited to approved functions; no service-role key in the orchestrator. Remember `getDb()` bypasses RLS, so every server path authorizes explicitly.
- Role authorization server-side on every API and tool.
- PII minimization: the model gets opaque tokens and only fields allowed at the current assurance level. Masked details in UI; "show full details" requires a reason and is logged.
- Secrets in the secret manager only; never in prompts, code, logs or fixtures.
- Encrypted transport everywhere; signed Twilio webhooks and WebSocket via `verifyTwilioSignature` (`src/lib/comms/twilio.ts:12`), failing closed when the auth token is unset; replayed or unsigned requests rejected.
- Append-only audit through `writeAudit()` to the existing `audit_log`; hash chain (owner decision pending, C7).
- Recording URLs are short-lived and authorized; never public.
- Safe errors: no stack traces, SQL or internal IDs to callers or clients.
- No production PII in tests or fixtures; redaction in logs and traces.
- Migrations: new files only (never edit an existing migration), forward + tested rollback, no data deletion, referential integrity kept.

## Threat models to test
Cross-role or cross-partner-agency access · prompt injection over the phone · spoofed caller ID · spoofed or replayed webhook · tool parameter tampering · unauthorized policy lookup · household-member disclosure · admin privilege escalation · duplicate outbound execution · recording URL leakage.

## Checks per change
Rate limits on public endpoints; dependency and container scans clean; security owner reviews security-sensitive changes.
