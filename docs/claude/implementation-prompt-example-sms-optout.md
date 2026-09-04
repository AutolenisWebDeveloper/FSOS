# Worked example — FSOS: SMS opt-out handling on the inbound Twilio webhook

Shows `implementation-prompt-template.md` filled at the level of detail that actually
prevents rework. Read this before filling the template for the first time.

> Historical note: the opt-out path described here now exists. The value of this file is the
> *shape* of the prompt — the density of instruction, and the refusal to let Claude assume.

---

## Objective & business outcome
When a customer texts STOP/UNSUBSCRIBE to our Twilio number, we must suppress all future
outbound SMS to that number and confirm compliantly, so we stop messaging opted-out users
(legal/compliance requirement).

## Non-goals
No new messaging UI. No changes to email. No new Twilio number provisioning.

## Existing functionality that MUST be preserved
The inbound Twilio webhook's current message handling and any existing signature verification
must keep working unchanged. The dispatcher's existing consent / quiet-hours / DNC gate
behavior must not be weakened or duplicated.

## Files/modules to inspect FIRST
Locate the inbound Twilio webhook route (grep for the Twilio signature header and the webhook
path). Trace: route → `readJson()` → validation → handler → messaging/service layer →
contact/consent model → tests. Produce an evidence table (`file:line`) for: where inbound SMS
is parsed, where outbound SMS is dispatched, and whether an opt-out/consent field already
exists. **Do NOT assume an opt-out column exists — verify it.** Note that STOP/HELP handling
may already be enforced by the dispatcher; confirm before adding anything parallel.

## Architecture constraints & invariants
Parse the webhook body through the shared helper and validate it with Zod. All outbound SMS
must continue to route through the existing compliance gate / dispatcher — **do not add a
second send path.** RLS must not be bypassed.

## Data-model implications
If no consent/opt-out field exists, add a **NEW** migration (never edit an existing one)
adding an opt-out flag + timestamp to the correct table, with the appropriate RLS policy.
Confirm the exact table by inspection first — do not guess between the aggregate-root schema
and the legacy customers table.

## Integration points
Twilio inbound webhook; the outbound dispatcher; the contact/consent model.

## Edge cases & failure modes
STOP variants (STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT) and START/UNSTOP resubscribe;
unknown number; number already opted out; malformed body; Twilio retry / duplicate delivery
(idempotency); signature verification failure; number mapping to multiple contacts.

## Security / authorization boundaries
Verify the Twilio request signature before processing anything. No PII in logs. Enforce
tenant scoping via RLS on the consent write.

## UI/UX requirements
N/A (webhook) — except that if an admin surface already lists contacts, it should reflect
opt-out state. Verify whether such a surface exists before touching it.

## Test requirements (repo harness)
Add tests under `tests/` as bare `.mjs` files using `node:assert/strict`, matching the nearest
existing test's structure. **No test framework**; no `describe`/`it`. Cases: opt-out sets the
flag; opted-out number is suppressed on outbound; resubscribe clears it; signature failure
rejects; every STOP variant is recognized; duplicate delivery is idempotent. A test that needs
a real Postgres to prove an RLS policy belongs in the `rls` set in `scripts/run-tests.mjs`,
not the default `unit` set.

Run: `npm run test`

## Verification steps
`npm run type-check`; `npm run lint`; `npm run build`; `npm run test` — show output.
Browser: N/A for the webhook itself. If an admin list exists, read-only visual check only; no
authenticated write-path E2E against production-backed data.

## Acceptance criteria
All listed tests pass; the outbound path checks opt-out before sending; the new migration
applies cleanly; no existing webhook behavior changed; no second send path introduced.

## Out of scope
Email suppression; a marketing-preference center UI.

## Authorization limits
You may add the migration file, write code, and run tests. **Do NOT run the migration against
production. Do NOT commit or push without my approval.**

## Required completion report
Three-bucket verification with real output; evidence table (`file:line`) for the opt-out
decision points; list of files changed and why; explicit statement that no existing capability
was removed.
