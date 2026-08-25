# Phase 2 — LIVE-verification runbook

Everything below is CONFIG/CODE-VERIFIED in the repo but requires a live environment to confirm.
Do NOT perform live writes/sends unless explicitly authorized. For each item: required access,
exact action, expected external evidence, expected FSOS-persisted evidence, pass condition, and
containment on failure.

## 1. Vercel cron execution (FSOS-070/071/072/073 + campaign engine)
- Access: Vercel project (Pro or a plan whose cron quota ≥ entries in `vercel.json`).
- Action: deploy; open Vercel → Cron Jobs; let each schedule fire (or trigger with
  `Authorization: Bearer $CRON_SECRET`).
- External evidence: every `vercel.json` path listed under Cron Jobs; each shows a successful run.
- FSOS evidence: `job_runs` row per (job:hour-bucket); detection jobs create work_tasks/activities/
  agent_actions; workforce builds `outreach_queue` rows; referral-sla writes agent_actions
  (reason=sla_breach); backup-verify writes an audit + activities heartbeat.
- Pass: each job fires on cadence and its handler persists its evidence; re-fire in the same window
  returns skipped (idempotent).
- Containment: remove/disable the offending entry in `vercel.json` and redeploy; handlers remain
  manually triggerable.

## 2. Production Supabase migration/schema state (FSOS-032 + general)
- Access: production Supabase (SQL / migration runner).
- Action: apply pending migrations, incl. `122_comm_message_events_dedupe.sql`.
- External evidence: `\d comm_message_events` shows `uq_comm_message_events_dedupe`.
- FSOS evidence: a duplicate provider callback does not add a second (message_id,event,provider_id)
  row.
- Pass: index present; duplicate callbacks collapse.
- Containment: `drop index uq_comm_message_events_dedupe;` (reverts to pre-fix behavior — dup rows,
  no data loss).

## 3. Twilio inbound + status callback (FSOS-020 / FSOS-030 / FSOS-031)
- Access: Twilio console (A2P-approved number/messaging service); `CRON_SECRET`/app URL.
- Action: send a governed SMS; observe the StatusCallback; reply STOP and a natural-language stop.
- External evidence: Twilio delivery logs; the StatusCallback URL carries `?mid=<comm_messages.id>`.
- FSOS evidence: status callbacks correlate by `mid` even before provider_id is patched → parent
  `comm_messages.delivery_status` advances; duplicate callbacks do not dup events (FSOS-032);
  STOP/natural-language stop terminate campaigns (FSOS-020) without resurrecting.
- Pass: correct lifecycle advance via mid; no orphan; no duplicate rows.
- Containment: correlation falls back to provider_id automatically; disable the sending number to
  stop traffic.

## 4. Resend webhook / delivery (FSOS-030 / deliverability)
- Access: Resend dashboard (webhook + signing secret `RESEND_WEBHOOK_SECRET`).
- Action: send a governed email; trigger delivered/opened/bounce events.
- External evidence: Resend event log; the event payload echoes `X-FSOS-Message-Id`.
- FSOS evidence: events correlate by the echoed id first (email_id fallback); bounce/complaint
  suppress via the existing path; no duplicate ledger rows.
- Pass: correlated lifecycle updates; dedupe holds.
- Containment: correlation falls back to email_id; pause the sending domain.

## 5. comm_suppression_apply production behavior (FSOS-020 dependency)
- Access: production Supabase.
- Action: invoke the RPC for a client suppression; attempt a governed non-transactional send.
- External evidence: none (internal).
- FSOS evidence: `comm_client_suppressions` row (status=blocked) written atomically with its audit;
  the send is withheld at the gate (blockedStep 'suppression'); the workforce excludes the contact
  at build (FSOS-070).
- Pass: suppression written atomically; send withheld.
- Containment: unblock via the RPC (never touches regulatory stores).

## 6. Google Calendar / freeBusy (FSOS-043 — read-only busy sync)
- Access: a connected Google account (booking host).
- Action: create a Google event overlapping a bookable slot; recompute availability.
- External evidence: the event in Google Calendar.
- FSOS evidence: `computeSlotsForType` excludes the busy window (loadGoogleBusy). NOTE: Google event
  PUSH is ABSENT by design (read-only busy sync) — do not expect FSOS to create Google events.
- Pass: the overlapping slot is suppressed.
- Containment: loadGoogleBusy fails safe (empty set) when Google is unconfigured/degraded.

## 7. Zoom (if still used) (FSOS-043)
- Access: Zoom integration credentials.
- Action: book/reschedule a video appointment.
- External evidence: the Zoom meeting created/updated.
- FSOS evidence: appointment carries zoom_meeting_id; reschedule updates the meeting time.
- Pass: meeting lifecycle tracks the appointment.
- Containment: Zoom client is a gated no-op when unconfigured.

## 8. Booking reschedule (FSOS-041 / FSOS-042) — live sanity
- Access: the app (an FSA/booker).
- Action: reschedule an appointment on a capped/buffered type to a valid nearby slot; force a
  concurrent overlap.
- FSOS evidence: the move succeeds (self no longer blocks itself); a real overlap returns a clear
  409 "taken", not a 500; the appointment row actually changes.
- Pass: reschedule works; overlap is a clean conflict.

## 9. API step-up enforcement (FSOS-060) — live sanity + PRE-DEPLOY CHECK
- Access: an aal1 (no-MFA) session and an aal2 session; the user/auth admin.
- PRE-DEPLOY (required): requireApiRole now applies aal2/step-up to EVERY gated API mutation on the
  fsa/admin/compliance/super portals (not just page loads). Confirm ALL production
  fsa/admin/compliance/super_admin users are already MFA-enrolled (aal2). This matches the existing
  page guard (they cannot load the pages otherwise), so it introduces no NEW break — but if any
  such account is still aal1 (e.g. it reached API routes via a token/integration while MFA was
  page-only), this change hard-locks it out of all writes until it enrolls.
- Action: call a gated mutation (e.g. /api/super/*) with each session.
- FSOS evidence: aal1 → 403 (mfa_required / stepup_required); aal2 with fresh step-up → allowed.
- Pass: step-up enforced at the API, matching the page guard.
- Containment: if a legitimate account is locked out, enroll it in MFA (the enrollment + /login/mfa
  paths are not behind requireApiRole), or temporarily revert src/lib/auth/api.ts's mfa block.

## 10. Public intake abuse controls (FSOS-062) — live sanity
- Action: flood /api/agencies/upload|referral from one IP; submit with the `company` honeypot set.
- FSOS evidence: 429 after the window limit; honeypot submissions write nothing; every real attempt
  is in the audit_log (actor 'public').
- Pass: throttle + honeypot + audit all observed.
