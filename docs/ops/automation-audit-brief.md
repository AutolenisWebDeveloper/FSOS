FSOS AUTOMATION ASSESSMENT AND REPAIR

PRIMARY OBJECTIVE
Perform a comprehensive production assessment and repair of the existing FSOS platform. The highest-priority outcome is that the functionality FSOS has already been designed and built to provide actually operates end-to-end.

Particular emphasis:
1. autonomous SMS
2. autonomous email
3. AI workforce
4. campaigns and sequences
5. referral follow-up
6. cross-sell workflows
7. term-conversion workflows
8. win-back workflows
9. appointments and reminders
10. inbound SMS
11. inbound email, where implemented
12. provider delivery callbacks
13. workflow triggers
14. cron and background jobs
15. queues
16. stopping conditions
17. retries
18. suppression
19. dashboards and operational status
20. state consistency: a change in one module (STOP, booking, reply, suppression) appears correctly on every screen and portal that shows it

The core requirement: if FSOS says an SMS or email automation exists, prove that it can execute by itself, from trigger to provider to outcome, without a user having the browser open.

The required execution chain:
business event → workflow trigger → eligibility detection → durable state/queue → scheduled execution → communication gate → Twilio SMS or Resend email → provider response → webhook/callback → communication history → workflow state update → next action or termination

Find every place where that chain breaks and repair it, within the guardrails below.

SCOPE
- Success is measured by the functionality FSOS already provides today: reliable autonomous SMS, email, workflows, campaigns, AI workforce actions, referrals, appointments and related operational processes.
- Voice is planned functionality. Inventory it only; do not build, modify or test it. It does not count against completion.
- If CLAUDE.md contains Voice Agent build rules, they govern voice work only. The general FSOS rules in CLAUDE.md still apply.
- Stay in scope. Record out-of-scope findings in the report; don't act on them.

DO NOT REBUILD THE COMMUNICATIONS PLATFORM
The repository already contains a substantial native communication architecture. Preserve and improve:
- src/lib/messaging.ts
- src/lib/comms/send.ts
- src/lib/comms/dispatcher.ts
- src/lib/comms/gate.ts
- src/lib/comms/inbound.ts
- src/lib/comms/events.ts
- src/lib/comms/campaign.ts
- src/lib/comms/campaign-ai.ts
- the related communications infrastructure

The goal is not to build SMS and email. The goal is to prove that every intended SMS and email workflow reaches the existing communication engine, and to repair anything preventing it.

sendThroughGate is the single outbound path; find where it lives. Find every Twilio or Resend call outside it (SDK calls and REST fetches, src/lib/messaging.ts included) and route it through the gate without removing callers. Never add a second send path.

GUARDRAILS
These override "prove it end-to-end" wherever the two conflict.

No real recipients
- No message may reach a real client. Live provider sends go only to the canary contacts I give you in chat. Canary records should be marked internal if FSOS supports it; don't add a mechanism for it.
- If a non-production environment with its own database and provider credentials exists, propose running canary checks there at the checkpoint. Otherwise list the production canary checks in the report; they run after I deploy.
- Provider error branches (invalid number, 21610, rejection, temporary failure) use Twilio test credentials and magic numbers where the send path supports them, otherwise a mock at the provider-client boundary. Email outcomes use Resend's test recipients: delivered@, bounced@, complained@ and suppressed@resend.dev.
- Test callback handlers by replaying correctly signed payloads (X-Twilio-Signature; Resend's svix-* headers).
- Browser and E2E verification runs against a local or staging build with seeded synthetic data, never production. Before npm run test:e2e or any Playwright session, report the base URL, the database, and whether test or live provider credentials are loaded (names only, never values). If any of them points at production or live keys, don't run it.
- No client PII in screenshots, traces, fixtures, logs, commits or reports.

Production is read-only
- Allowed: aggregate SELECTs (counts, ages, status distributions; never names, phones, emails or policy numbers); Vercel logs and cron configuration; Twilio and Resend counts, statuses, error codes and webhook configuration. Don't pull recipient lists or message bodies. If logs contain client PII, don't copy it anywhere; report where it's logged as a finding.
- Hard stops (ask in chat and wait for a yes): any send to anyone other than the canary; any production write, including migrations, data fixes, canary records and queue expiry; merge or deploy, to any environment; changes to env vars, cron schedules, webhook URLs or provider settings; turning on any flag, switch, agent, campaign or sequence; any change to gate policy.
- Work on fix/automation-e2e, one commit per repair with its regression test, then open a PR. Don't merge or deploy.
- Schema changes are migrations with a tested rollback, with agency row-level security on any new table. Never delete data; expire or cancel instead.

Gate integrity
- A gate block is a correct outcome. Never loosen consent, DNC/STOP, quiet-hours, approved-template, no-recommendation or securities-firewall rules; never default consent to true; never add a bypass so a workflow can send. A workflow blocked for lack of consent is OPERATIONAL (blocked as designed).
- If code and documented policy disagree, don't pick a side: leave the code as is, log it as a gate-policy question and continue. Where FSOS policy decides an expected outcome below, report what the code does; don't change it.
- The gate runs at dispatch and on every retry, not only at enqueue.
- A referrer can't consent for the person referred. Referral SMS stays blocked without that person's own consent record.
- AI-drafted content passes the same approved-template and no-recommendation checks as everything else. If the approved-template rule blocks every AI draft, report the design conflict; don't bypass it.

Connected is not enabled
- Repair wiring, but leave enablement as you found it. Anything disabled, paused or flagged off stays that way.
- Any consumer you connect, and any behavior you move server-side, ships behind an off-by-default switch, so a merge or deploy never starts sending on its own. Use FSOS's existing flag mechanism, ideally with a canary-only state; if none fits, add the smallest one, with off, canary-only and on states. Report these as REPAIRED, DISABLED.
- Before connecting a consumer to an existing queue or state table, report its pending row count and age distribution and propose a stale-row policy: expire rows whose window has closed, whose appointment has passed, or whose contact has since replied, booked or opted out. Approved stale-row actions go in a migration or script on the branch.
- Connected dispatchers must respect the A2P 10DLC campaign's throughput; report how.

FIND THE DISCONNECTED AUTOMATION
This is one of the most important parts of the assignment. Search FSOS for functionality that appears implemented from the UI or configuration but is not connected to execution. Examples:
- UI displays automation → no backend trigger
- workflow definition exists → never scheduled
- campaign active → no enrollment
- sequence exists → no worker advances it
- queue row created → nothing consumes it
- cron job function exists → absent from the scheduler
- scheduler calls a job name → job not registered
- template exists → no workflow references it
- AI agent appears active → never receives candidates
- event trigger displayed → nothing subscribes to the event
- appointment created → outreach sequence continues anyway
- customer replies → future scheduled messages still send
- provider accepts SMS or email → callback never updates FSOS
- webhook receives a provider event → workflow does not respond
These are higher-priority defects than new features.

KNOWN DEFECT: GITHUB ISSUE #265
Read issue #265 first. It identifies pipeline-winback event-driven SMS that is displayed as operational but apparently has no dispatcher attached. Treat it as evidence of a broader failure class. Don't fix only #265; search the entire application for the same pattern.

For every automation shown in FSOS, answer: what exact server-side event causes this to execute? If there is no answer, it is not automation.

AUTONOMOUS SMS
Prove the complete path:
trigger → recipient → consent → suppression/DNC → quiet hours → template/content → gate → durable communication record → Twilio → MessageSid → status callback → delivered/failed state → next workflow action

Each case must produce the stated outcome:
- Normal delivery: MessageSid stored; callbacks only move status forward, ending at delivered; next step scheduled.
- Invalid number or permanent provider rejection: failed, not retried, number flagged.
- Temporary failure: bounded retries with backoff, same idempotency key, gate re-checked on each attempt.
- No consent: blocked at the gate with a recorded reason; Twilio never called.
- STOP: suppression written; pending SMS to that contact canceled before dispatch; exactly one opt-out confirmation (Twilio's or FSOS's, not both).
- Twilio error 21610: permanent, suppression written, never retried.
- Quiet hours: evaluated in the recipient's local time, not server UTC, including a DST boundary case (Sunday, Nov 1, 2026). Report the window the gate enforces.
- Duplicate dispatch, including overlapping cron runs: one provider call.
- Duplicate, out-of-order, unsigned or forged callback: duplicates are idempotent; status never regresses (a late "sent" never overwrites "delivered"); unsigned or forged requests are rejected.
- Worker crash or timeout mid-batch: claimed rows are released when the lease expires and picked up again, with no double send.
- Campaign suppression, a booking, or a reply after the next outreach was scheduled: that step is canceled before dispatch.
- Inbound reply from a number shared by several contacts or agencies: routed to the right thread, with stop conditions applied to the right enrollments. Report how ambiguity is resolved.

AUTONOMOUS EMAIL
Prove:
trigger → recipient → eligibility → approved content → gate/policy → durable communication record → Resend → provider ID → webhook → delivered/bounced/complained state → suppression where appropriate → workflow continuation

Autonomous email must not merely create database records. It must reach Resend through the real provider path: Resend's test recipients during this work, and the canary for live verification.

Each case must produce the stated outcome:
- Resend test recipients (delivered, bounced, complained, suppressed): provider ID stored; webhook updates state; hard bounce and complaint write suppression; delivery_delayed never regresses state.
- Unsubscribe link and one-click List-Unsubscribe: suppression written and marketing email blocked at the gate; transactional email such as appointment reminders follows documented policy.
- Inbound email reply, where implemented: the same stop conditions as an SMS reply.

APPOINTMENTS AND REMINDERS
- A booking stops prospecting sequences for that contact.
- A reschedule re-times reminders and cancels the old ones; a cancellation removes them.
- Reminder times are computed in the appointment's time zone and stay correct across the Nov 1, 2026 DST change.

AI WORKFORCE
Audit the actual operational status of every AI workforce agent. A roster entry doesn't mean an agent works. For each agent, establish:
candidate detection → queue creation → daily target → atomic claim → AI drafting → message validation → gate → Twilio/Resend → message record → outcome → stopping condition

Pay particular attention to cross_sell, term_conversion, referral_followup, life_winback, marketing_automation and any other current outreach agent. Classify each as fully operational, partially connected, detection-only, draft-only, UI-only, disabled or broken.

Operating documentation outside this repo (treat it as a claim to verify) says win-back and cross-sell route through marketing_automation with audiences winback and cross_sell. The roster also lists cross_sell and life_winback agents, and #265 describes a separate pipeline-winback event path. Establish which path is canonical for each workflow and whether more than one path can message the same contact. When one contact is eligible for several workflows at once (conversion, cross-sell, win-back), report whether any cross-workflow dedupe or frequency cap exists.

Repair the wiring for functionality the current FSOS product intends to be live, under "Connected is not enabled." Don't invent new agents unless an existing documented workflow requires one.

AUTOMATION MUST RUN WITHOUT THE UI
Test this principle explicitly: would this process still run if every user logged out of FSOS and closed their browser?

Any automation whose execution depends on React rendering, component mounting, browser timers, page visits, button clicks that were meant to be automatic, or an admin opening a dashboard is not autonomous. Move intended autonomous behavior to the existing server-side job and workflow infrastructure, behind its switch. Leave the browser-triggered path in place and make it stand down when the server-side switch is on, so the behavior never runs twice and never stops running.

Operational status shown in the UI must come from execution evidence (last successful run, next run, pending depth), never from a config flag alone.

EVIDENCE
- Tag every status with its highest evidence level: CODE-TRACED (file:line), TEST-VERIFIED (mocked; name the test), BROWSER-VERIFIED (Playwright spec or MCP session), LIVE-VERIFIED (canary MessageSid or Resend ID plus the callback that updated FSOS). Report mocked and live results separately. Never report a check as passing unless you ran it in this session.
- Live verification of a switched-off automation needs a state that reaches only the canary. If its switch has none, say so; never turn an automation on for everyone to test it.
- For each automation, pull read-only production aggregates: last successful run, sends in the last 7 and 30 days, share of sends reaching a terminal provider status, pending queue depth and the oldest pending item. An automation shown as active with no sends and a growing queue is disconnected.

REQUIRED SKILLS AND TOOLS
This assessment is complex enough that you must actively use the repository's engineering skills and verification tools, not treat them as optional references. If a named skill or tool isn't installed, say so in the report and continue; never claim you used something you didn't.

Superpowers
Start with using-superpowers, then use the appropriate workflow throughout:
- systematic-debugging: investigate root causes before patching symptoms
- writing-plans: create the implementation plan after repository investigation
- test-driven-development: reproduce verified defects and add regression coverage
- verification-before-completion: don't declare anything fixed without evidence
- requesting-code-review: the final adversarial implementation review
- dispatching-parallel-agents and subagent-driven-development, where parallel investigation genuinely improves the assessment. Parallel subagents investigate read-only; repairs run one at a time, never in parallel on the same files.
Don't skip the investigation and verification discipline because a defect looks obvious.

FSOS-specific skills
Load and use the applicable project skills, particularly fsos-crm-workflows, fsos-security-audit, fsos-testing, fsos-deliverability, fsos-email-template-qa, twilio-a2p-compliance, supabase and supabase-postgres-best-practices. Also load any installed skill that covers the outbound gate, the compliance firewall or data security (for example fsos-outbound-consent-gate, fsos-financial-compliance-firewall, fsos-data-security). Treat the repository's implementation and current skill instructions as authoritative.

Frontend Design
Use frontend-design for every operator-facing surface this work touches. Don't make backend automation work while leaving misleading status labels, dead controls, fake automation indicators, inaccessible states, broken loading, error or empty states, or inconsistent dashboards. Changed UI must stay consistent with the existing FSOS design system and application architecture.

Impeccable
Use impeccable for the final UI quality pass on every modified operator-facing surface. Evaluate information hierarchy, density, readability, alignment, visual consistency, responsive behavior, state clarity, interaction quality, accessibility and polish. Improve the existing design system; don't redesign FSOS into a different visual product.

Playwright
Use the configured Playwright MCP or browser tooling and the repository's Playwright configuration for real browser verification, within the browser guardrail above. Source review alone is insufficient. For affected workflows, verify the rendered application and real interactions, as applicable: AI Workforce, outreach queue, communications, conversations/inbox, campaigns, campaign detail, referrals, appointments, automation status, delivery and error states, and blocked and suppressed states.

Confirm that:
1. the page loads
2. no material console or runtime errors occur
3. controls perform the action they claim to perform
4. backend state is reflected correctly in the UI
5. a reload preserves durable state
6. automation status is truthful
7. error, empty, loading and success states work
8. responsive behavior isn't broken

Run the repository's existing E2E command, npm run test:e2e, where applicable. Don't claim BROWSER-VERIFIED unless the workflow was exercised through Playwright or browser tooling.

WORKING METHOD AND SEQUENCE
Superpowers investigation → repository evidence → systematic debugging → implementation plan → checkpoint → TDD and targeted repair → FSOS security and comms validation → frontend-design → impeccable → Playwright verification → full verification → adversarial code review. Don't skip directly from finding a suspicious file to editing it.

1. Inventory first, in docs/ops/automation-inventory.md, kept current as you work; it's the resume point if the session compacts or ends. One row per automation: UI surface | trigger (file:line) | schedule or registration | queue or state table | consumer | gate call | provider call | callback handler | stop conditions | furthest verified link | status | evidence. Diff in both directions: handlers vs. scheduler entries, emitted events vs. subscribers, queue tables vs. consumers, templates vs. the workflows that reference them, and UI "active" indicators vs. server code paths.
2. Checkpoint. Stop once and present: the inventory summary; the repair plan; backlog numbers and a proposed stale-row policy for every consumer you'd connect or move server-side; gate-policy questions; and the production canary checks you propose, each with the records and trigger events I'll need to create and any action I'll need to take (reply, text STOP, click unsubscribe). Wait for my approval, then work through the approved items without further check-ins except at hard stops.
3. Repair in this order:
   a. anything that can send when it shouldn't: gate bypasses, stop conditions, suppression, dispatch-time checks
   b. term_conversion, because conversion deadlines are the only hard-dated items and a missed window can't reopen
   c. provider callbacks and status truth
   d. remaining workflows
   e. UI truthfulness, then the frontend-design and impeccable pass
4. Close the #265 failure class with a wiring regression test that fails if any automation the UI presents as automatic lacks a registered server-side trigger and consumer. If the UI's automation list is hard-coded, report that as part of the defect.
5. The final adversarial review runs in a subagent that wrote none of the repairs. It re-runs the tests, checks the code rather than the report, and marks any PASS it can't reproduce NOT VERIFIED. Fix what it finds, then open the PR with the report linked in its description.

FINAL STATUS REPORT
Write it to docs/ops/automation-audit-report.md, with no client PII. One row per automation from the inventory, with the furthest verified link in the chain and the highest evidence level reached.
- OPERATIONAL: every link verified end-to-end, including gate blocks that behaved as designed.
- REPAIRED: defect found and fixed; name the regression test and commit.
- REPAIRED, DISABLED: wiring fixed; switched off pending my approval.
- BROKEN: defect found and not fixed; root cause, file:line, and what the fix requires.
- BLOCKED: needs my decision, an approval, or access you don't have.
- PARTIAL: implementation exists, but a named external or configuration dependency prevents full verification.
- PLANNED / NOT BUILT: intentionally not implemented, voice included. Voice does not count against completion.

Then list separately:
- gate-policy questions for me
- misleading UI you corrected
- stale-row actions on the branch and the order to run them at deploy
- the post-deploy canary checks that would make each repaired automation LIVE-VERIFIED, with the records, trigger events and switch state each needs
- out-of-scope findings you did not act on
