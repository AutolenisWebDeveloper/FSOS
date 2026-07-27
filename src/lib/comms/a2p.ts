// src/lib/comms/a2p.ts
// Three-life-campaigns launch, Slice 7 — the single A2P 10DLC go-live flag.
//
// SMS is A2P-gated: FSOS must NOT text real contacts until the A2P 10DLC brand/campaign
// is APPROVED by the carriers. This module is the one source of truth for that flag,
// read by the send-time gate (gate step `sms_live`), the drip runner (holds SMS steps),
// and the SMS provider (defensive backstop) — so no code path can send an SMS while the
// flag is false.
//
// It is a deliberately simple, config-default switch (§4.3): default FALSE (staged). The
// moment A2P approval lands, set SMS_A2P_APPROVED=true — SMS activates on the next dispatch
// cycle with no further build. Email is never A2P-gated and ignores this flag entirely.

/**
 * True only when the A2P 10DLC campaign is approved and SMS may send to real contacts.
 * Defaults to FALSE (staged) unless SMS_A2P_APPROVED is explicitly "true"/"1"/"yes".
 */
export function smsA2pApproved(): boolean {
  const v = (process.env.SMS_A2P_APPROVED || '').trim().toLowerCase()
  return v === 'true' || v === '1' || v === 'yes'
}

/**
 * The channel-level `smsLive` gate signal for a send: email is never A2P-gated (always
 * true); SMS is live only when A2P is approved. Fed into the pure gate as `smsLive`.
 */
export function smsLiveFor(channel: 'sms' | 'email'): boolean {
  return channel === 'email' ? true : smsA2pApproved()
}
