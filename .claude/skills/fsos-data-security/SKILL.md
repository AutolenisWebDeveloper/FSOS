---
name: fsos-data-security
description: Use for any Voice Agent change touching data, schemas, migrations, secrets, logs, webhooks, exports, recordings or roles. Tenant isolation, PII handling and threat modeling.
---

# FSOS data security

## Enforce
- Row-level security by agency on every new table, following the existing FSOS pattern (see repo-map for auth claims). Tests prove cross-agency reads and writes fail.
- Dedicated least-privilege orchestrator role limited to approved functions; no service-role key in the orchestrator.
- Role authorization server-side on every API and tool.
- PII minimization: the model gets opaque tokens and only fields allowed at the current assurance level. Masked details in UI; "show full details" requires a reason and is logged.
- Secrets in the secret manager only; never in prompts, code, logs or fixtures.
- Encrypted transport everywhere; signed Twilio webhooks and WebSocket; replayed or unsigned requests rejected.
- Append-only audit; hash-chained audit log.
- Recording URLs are short-lived and authorized; never public.
- Safe errors: no stack traces, SQL or internal IDs to callers or clients.
- No production PII in tests or fixtures; redaction in logs and traces.
- Migrations: forward + tested rollback, no data deletion, referential integrity kept.

## Threat models to test
Cross-agency access · prompt injection over the phone · spoofed caller ID · spoofed or replayed webhook · tool parameter tampering · unauthorized policy lookup · household-member disclosure · admin privilege escalation · duplicate outbound execution · recording URL leakage.

## Checks per change
Rate limits on public endpoints; dependency and container scans clean; security owner reviews security-sensitive changes.
