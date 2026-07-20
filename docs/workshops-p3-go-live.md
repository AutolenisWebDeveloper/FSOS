# Workshop Delivery Automation (P3) — Go-Live Checklist

> Scope: the **non-code** tasks required to run the P3 virtual-delivery features
> (per-registrant Zoom provisioning, the Zoom attendance webhook, finite-window replay,
> and the post-event feedback survey) in production. Code for all of these has shipped
> credential-gated and approval-gated — it stays dormant until the items below are done.
> Nothing here asserts a Farmers/FFS/carrier rule as settled; every REQUIRES-APPROVAL item
> is owned by the FSA / Ryan Anderson (FFS compliance).

## A. Zoom credentials (unblocks provisioning + attendance webhook)

All four are **env-only** — never commit them.

| Env var | Where to get it |
|---|---|
| `ZOOM_ACCOUNT_ID` | Zoom Marketplace → Build App → **Server-to-Server OAuth** → App Credentials |
| `ZOOM_CLIENT_ID` | same app → App Credentials |
| `ZOOM_CLIENT_SECRET` | same app → App Credentials |
| `ZOOM_WEBHOOK_SECRET_TOKEN` | same app → Feature → **Event Subscriptions** → Secret Token |

Steps:
1. Create the S2S OAuth app; add scopes `meeting:write:admin` (registrant create) and, if you
   run webinars, `webinar:write:admin`.
2. Add an **Event Subscription** pointing at `https://<domain>/api/webhooks/zoom` and subscribe:
   `meeting.participant_joined`, `meeting.participant_left` (and the `webinar.*` equivalents
   if using webinars). Zoom sends a **URL-validation (CRC)** challenge — the endpoint answers
   it automatically once `ZOOM_WEBHOOK_SECRET_TOKEN` is set.
3. Store each session's Zoom meeting id in `workshop_sessions.zoom_meeting_id` (staff UI /
   session authoring). Provisioning is a no-op without it.
4. Verify: register a test attendee on a virtual session → a personalized `join_url` +
   `zoom_registrant_id` should be stored. If Zoom was down at registration, run the staff
   retry `POST /api/workshops/[id]/provision-zoom`.

**Until these are set:** provisioning is a clean no-op (registration still succeeds), and the
webhook fails closed in production (rejects unverified requests).

## B. Approved recording-consent disclosure (unblocks replay)

The replay surface **cannot activate** until an approved recording-consent disclosure exists
(retained-communication rule, 17a-4/4511 — precondition R7).

1. Ryan Anderson provides the recording-consent disclosure copy (all-party-state rule).
2. Set `workshop_disclosure_configs` row `kind='recording'` to the approved body with
   `is_assumption=false` and `approved_by` populated (via the compliance approval flow).
3. Populate `workshop_sessions.recording_url` + `recording_expires_at` (finite window; the
   default window is `workshop_comms_config.replay_window_days`, currently 14 — assumption-badged).
4. Verify `/workshops/[slug]/replay?t=<join_token>` serves the recording and renders the
   approved disclosure. Before this, the page shows "Recording not yet available".

## C. Feedback → consult routing

No new config. `consult_requested=true` routes into the existing consult spine
(`convertRegistrationToLead`): GHL Pipeline-A `prospect_client` for non-securities workshops,
and the **FFS-supervised path** for `is_security=true` workshops (never the automated
sequence). Confirm GHL is live (see D) for the non-securities path to push.

## D. Carried-over non-code tasks (from P0–P2)

- **GHL workflow hand-build (P2 runbook):** the pre-event reminder + post-event nurture
  workflows (WF-* by tag) are built manually in the GHL UI per `docs/ghl_integration.md`.
  Tags/`lead_source="Event"` are the binding contract; confirm each workflow in GHL.
- **Approved disclosure + SMS/A2P copy (R2/R4/R6):** the seminar-advertising, educational,
  and SMS disclosures must be approved (`is_assumption=false`) before a workshop can publish.
- **A2P 10DLC:** brand/campaign registration + template approval for the SMS traffic type
  (carrier + TCPA) must be complete before SMS reminders/nurture go live.
- **Retention archive (R8):** confirm where SMS + recordings land for the 17a-4/4511 archive.
- **Farmers/FFS/compliance sign-offs (R1–R10):** per the design spec §8 REQUIRES-APPROVAL
  register — 2210 classification, principal pre-approval, filing decisions, senior-designation
  and free-lunch reviews as applicable.

## E. Environment / deploy

- Set the four `ZOOM_*` vars in the Vercel project env (Production + Preview as needed).
- No secrets are committed; `.env.local.example` documents the variable names only.
