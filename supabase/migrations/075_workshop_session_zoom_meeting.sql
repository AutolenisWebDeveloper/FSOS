-- ─────────────────────────────────────────────────────────
-- Migration: 075_workshop_session_zoom_meeting
--
-- Workshop virtual-delivery fix — store the CREATED Zoom meeting on the session.
--
-- WHY THIS EXISTS
--   `workshop_sessions` has only `zoom_meeting_id` (mig 038), and nothing ever populated it:
--   the code assumed the Zoom meeting was created out-of-band. `provisionZoomForRegistration`
--   (src/lib/workshops/server.ts) therefore always hard-skipped virtual/hybrid sessions with
--   reason 'no_meeting_id', so NO registrant ever got a join link. FSOS now CREATES the
--   meeting on workshop/session creation (src/lib/zoom/client.ts → createZoomMeeting), so we
--   need somewhere to persist the meeting's host link + attributes alongside `zoom_meeting_id`.
--
--   Mirrors the native-booking appointments columns (mig 069): join_url is client-facing,
--   start_url is FSA/host-ONLY and is NEVER returned to a registrant/client or logged
--   (guardrail: only join_url is ever exposed to attendees — attendees actually join through
--   their per-registrant link from addZoomRegistrant, so the session join_url is a fallback).
--
-- SAFETY: additive only (add column if not exists) — no drops, no data movement, no anon grant.
-- ─────────────────────────────────────────────────────────

alter table workshop_sessions
  add column if not exists zoom_meeting_uuid text,   -- Zoom meeting UUID (webhook/report correlation)
  add column if not exists zoom_join_url     text,   -- generic attendee join link (fallback; per-registrant link preferred)
  add column if not exists zoom_start_url    text,   -- HOST-ONLY start link — NEVER sent to attendees/clients or logged
  add column if not exists zoom_passcode     text,   -- meeting passcode
  add column if not exists zoom_dial_in      text;   -- first global dial-in number (config default; no securities data)

comment on column workshop_sessions.zoom_start_url is
  'FSA/host-only Zoom start URL. NEVER sent to a registrant/client or logged (only zoom_join_url / the per-registrant link is attendee-facing).';
comment on column workshop_sessions.zoom_meeting_id is
  'Zoom meeting id created by createZoomMeeting on workshop/session creation. Presence makes provisionZoomForRegistration idempotent (never re-creates).';
