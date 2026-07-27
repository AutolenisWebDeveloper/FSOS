# Launch Slice 7 — Stage SMS behind the A2P 10DLC approval flag

**Status:** Code complete + tested. SMS is fully built and staged; live SMS is held until A2P approval.
**Date:** 2026-07-26

A2P 10DLC is **submitted, not yet approved**. This slice adds the **single go-live flag** that guarantees no SMS reaches a real contact before approval, and makes flipping that flag — the moment approval lands — activate SMS with **no further build**.

## The flag

`SMS_A2P_APPROVED` (env). Default/unset = **staged** (SMS held). Set to `true` on approval.
Source of truth: `src/lib/comms/a2p.ts` — `smsA2pApproved()` / `smsLiveFor(channel)`. Email is never A2P-gated.

## Three enforcement points (defense in depth — SMS cannot leak while staged)

1. **The send-time gate (primary).** `gate.ts` gains step **`sms_live`** (a non-escalating operational *hold*, like `business_hours`). `send.ts` computes `smsLive = smsLiveFor(channel)` server-side and passes it into every gate evaluation, so **no caller can bypass it**. A staged SMS is blocked with reason "SMS is staged pending A2P 10DLC approval" and **never sent**. It's a *hold*, not an escalation — it does not spam the FSA, and a real compliance block (consent / DNC / securities / recommendation) still surfaces and escalates *first* (the hold is checked last, among the deferrals).
2. **The drip runner.** `dripAdvance()` holds SMS-channel enrollments (`continue` without advancing the step cursor) while staged — so an SMS step is **queued, not skipped**. It auto-sends on the next cycle once the flag flips. Email drips are unaffected.
3. **The SMS provider (backstop).** `sendSms()` returns `{ ok:false, skipped:true, error:'sms_pending_a2p_approval' }` while staged, so even a code path that bypassed the gate cannot place an SMS.

## UI

The campaigns list shows a **"Pending A2P"** badge on SMS campaigns while staged, so the FSA knows those campaigns will hold (queued, not sent) until approval.

## Go-live (when A2P approval lands)

1. Confirm the approved A2P sending number is set (`NEXT_PUBLIC_SMS_FROM` / `TWILIO_MESSAGING_SERVICE_SID` mapped to the approved campaign).
2. Set `SMS_A2P_APPROVED=true` in the environment.
3. SMS activates on the next `/api/cron/campaign-dispatch` cycle — held SMS drips resume from where they were queued. No code change, no redeploy of logic.

## Tests

`tests/comms-a2p-gate.test.mjs` (9, offline/pure): SMS held when the flag is false (non-escalating), sends when true, email never gated, a real compliance block wins over the hold, and the flag reader fails safe (default staged; only `true`/`1`/`yes` approve). `build`, `type-check`, `lint`, and the gate/simulation/policy test cluster all pass.

## Scope

Adds a gate step + a flag module + a drip hold + a provider backstop + a UI badge. **No** second engine/gate/provider, no schema change. The three campaigns' SMS templates + sequences are authored in Slice 4; this slice guarantees they cannot send until A2P clears.
