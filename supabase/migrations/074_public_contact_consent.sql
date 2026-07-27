-- ─────────────────────────────────────────────────────────
-- Migration: 074_public_contact_consent
--
-- A2P 10DLC / TCPA fix — persist PUBLIC-INTAKE customer-care SMS consent into a store
-- the PRODUCTION OUTBOUND AUTHORIZATION LAYER actually reads before sending.
--
-- WHY THIS EXISTS
--   The homepage contact form captures affirmative SMS consent, but a public lead is a
--   `referrals` row with NO household member yet (the aggregate-root spine materializes a
--   household_member only on conversion). The enforceable member-keyed `consents` table
--   (mig 009) therefore cannot hold this consent at intake. Recording consent ONLY in
--   `audit_log` — which the send path never reads — would be a FALSE compliance control:
--   the gate's step-1 consent check (src/lib/comms/send.ts → hasConsent) would still see
--   "no consent" and block, OR (worse, if bypassed) a send could go out with the consent
--   evidence living somewhere the authorization layer never consults.
--
--   This table is the durable, CONTACT-RESOLVABLE per-channel consent-evidence store the
--   send path DOES read. It mirrors the blessed workshop pattern (workshop_consent_events,
--   mig 038) — durable consent evidence for a pre-conversion entity — but is keyed by the
--   normalized CONTACT so `sendThroughGate` can resolve it for ANY outbound SMS to that
--   number by phone suffix (exactly like the DNC lookup), not only via a bespoke caller.
--
-- SEMANTICS
--   • Append-only in practice: one row per consent ACTION (granted / revoked). "Latest
--     captured_at wins" — a later `revoked` overrides an earlier `granted`. The pure
--     decider is src/lib/comms/contact-consent.ts (offline-tested).
--   • The ENFORCED revocation path stays `dnc_entries` (mig 009): STOP (inbound.ts) and
--     the public opt-out route both write it, and the send path checks it independently at
--     gate step `dnc` for EVERY send by phone suffix. This table's `revoked` rows are
--     evidence + store-consistency; DNC is the authoritative TCPA opt-out backstop.
--   • Consent is purely INFORMATIONAL customer-care (carrier 30913: marketing consent is a
--     SEPARATE grant and is NOT collected here).
--   • Full TCPA/A2P evidence per row: exact wording shown, template version, source URL,
--     server-derived IP + user agent, timestamp.
--
-- FIREWALL (§4.1): no securities data — only contact + consent evidence.
--
-- Additive · idempotent · forward-only. Default-deny under RLS; service-role writes
-- (public routes + the send path use getDb() = service role, bypassing RLS). Staff /
-- compliance read, matching the workshop_consent_events consent-evidence policy (mig 038).
-- ─────────────────────────────────────────────────────────

create table if not exists comm_contact_consents (
  id              uuid primary key default gen_random_uuid(),
  -- Normalized resolution key: SMS → '+' + digits (E.164-ish); email → lower-cased.
  -- Matched TOLERANTLY at send time (SMS by last-10 suffix) to survive +1/bare drift,
  -- exactly like dnc_entries matching (src/lib/comms/send.ts onDNC).
  contact         text not null,
  channel         text not null check (channel in ('sms','email','call')),
  action          text not null default 'granted' check (action in ('granted','revoked')),
  -- TCPA / A2P 10DLC evidence.
  consent_text    text not null,              -- EXACT disclosure wording shown at the checkbox
  consent_version text not null,              -- deployed consent-template version (content-derived)
  source_url      text,                       -- where consent was captured (e.g. .../#contact)
  ip_address      text,                       -- server-derived on submit (unmasked — evidence)
  user_agent      text,                       -- server-derived on submit
  -- Identity linkage: the intake lead this consent attaches to (Change 2b). member_id is
  -- backfilled when the lead converts to a household member (spine WF-1); null at intake.
  referral_id     uuid references referrals(id) on delete set null,
  member_id       uuid references household_members(id) on delete set null,
  captured_at     timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

-- Send-time resolution indexes:
--   • (channel, captured_at desc) serves the SMS path — a suffix `ilike '%<tail>'` match
--     scanned in recency order within a channel, taking the newest row (latest-wins).
--   • (channel, contact) serves the EMAIL path, which resolves by exact lower-cased address.
create index if not exists idx_ccc_channel_captured on comm_contact_consents (channel, captured_at desc);
create index if not exists idx_ccc_channel_contact on comm_contact_consents (channel, contact);
create index if not exists idx_ccc_referral on comm_contact_consents (referral_id);

alter table comm_contact_consents enable row level security;

-- Consent evidence read: restricted to compliance / supervisory / licensed staff — the
-- same audience as workshop_consent_events (mig 038). Writes are service-role only (no
-- write policy → RLS denies non-service roles; the public routes + send path use the
-- service-role client which bypasses RLS).
drop policy if exists ccc_staff_read on comm_contact_consents;
create policy ccc_staff_read on comm_contact_consents for select using (
  is_super() or has_role('compliance') or has_role('supervisor')
  or has_role('fsa') or has_role('licensed_staff')
);
