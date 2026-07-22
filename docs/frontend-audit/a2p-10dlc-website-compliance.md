# A2P 10DLC / TCPA / TRAIGA — Website Compliance Report

> **Scope:** the public website surface that carriers and The Campaign Registry
> review when approving A2P 10DLC SMS campaigns (messaging path: Twilio via
> GoHighLevel). Frontend audit only — no backend/dispatcher changes.
> **Authority:** `twilio-a2p-compliance` skill wins on any conflict.
> **Status date:** 2026-07-22. **Verified against the live repo, read-only.**

## Executive summary

The core carrier-reviewable pages are **present and compliant**: the Privacy
Policy carries the required no-third-party-sharing SMS clause (the #1 rejection
cause), and the SMS Terms / Terms of Use pages carry the full program
disclosure. The homepage consultation form (`SiteContactForm`) is a
**gold-standard, un-prechecked opt-in CTA**. The remaining gaps are (a)
**inconsistent consent copy across the five phone-collection forms**, (b) the
`/refer` page missing its legal footer, and (c) the **TRAIGA AI-interaction
disclosure not surfaced at the point of consent** (only in the outbound message
body). All copy remediation is **legally binding, carrier-reviewable language →
human legal + Ryan Anderson (FFS Compliance TX) sign-off required before merge**
(§12.5). This report does not draft that language.

## Surface-by-surface status

| # | Surface | Status | Evidence |
|---|---------|--------|----------|
| 1 | Privacy Policy — no-3rd-party SMS clause | **PRESENT** | `src/app/privacy/page.tsx` (callout ~51-60; §3 SMS ~84-101; carve-out ~110-120) |
| 2 | SMS Terms / Terms of Use | **PRESENT** | `src/app/sms-terms/page.tsx`; `src/app/terms/page.tsx` §4 (~67-73) |
| 3 | Consent CTA on phone-collection forms | **PARTIAL** (inconsistent) | 5 forms, see below |
| 4 | TRAIGA AI-interaction disclosure at consent point | **MISSING** (frontend) | only in message body: `src/lib/compliance.ts` `TRAIGA_SMS_FOOTER` |
| 5 | Footer legal links on every public page | **PARTIAL** | `/refer` renders no footer |

### Surface 3 — consent CTA per form

| Form | File | Status | Missing |
|------|------|--------|---------|
| Homepage consultation | `src/components/public/site/SiteContactForm.tsx` (164-180) | **PRESENT — model** | — (un-prechecked; brand, recurring, Msg&data rates, STOP/HELP, not-a-condition, Privacy+Terms+SMS-Terms links, non-sharing note) |
| Workshop register (×2) | `src/components/public/WorkshopRegisterForm.tsx` (162-173); `.../site/WorkshopRegisterFormSite.tsx` (144-154) | **PARTIAL** | full disclosure comes only from DB `workshop.sms_disclosure`; **no static fallback** → empty field ⇒ no brand/rates/STOP-HELP |
| Public form builder | `src/components/public/PublicForm.tsx` (143-165) | **PARTIAL/weak** | no brand, no "recurring automated", no STOP/HELP, **no Privacy/SMS-Terms links** in consent block |
| Referral (`/refer`) | `src/components/public/PublicReferForm.tsx` (90-115) | **PARTIAL/weak** | no brand, no HELP, **no `/sms-terms` link**; + referrer-consents-for-3rd-party-number (TCPA design concern) |
| Agency referral (`/[slug]`) | `src/app/[slug]/page.tsx` (175-177) | **MISSING** | collects `client_phone` with **no SMS consent checkbox at all** |

`src/components/public/ConsentForm.tsx` is opt-out/DNC only — correctly N/A.

## Backend — verify-but-do-not-modify (status only; all appear PRESENT & wired)

- **7-step gate** `src/lib/comms/gate.ts` — ordered, blocks on first failure, escalates.
- **STOP/HELP** `src/lib/comms/keywords.ts` + `inbound.ts applyOptOut` (revokes consent + inserts `dnc_entries` on STOP). ⚠️ **Confirm an explicit approved HELP auto-reply** is emitted — `processInbound` branches `stop`/`start` explicitly; `help` falls through to auto-reply/escalate (carriers test HELP).
- **Consent capture/storage** `consents` upsert; forms post `consent_sms`/`consent_email`; `workshop_consent_events`.
- **DNC suppression** `dnc_entries` + gate step 3, re-checked at send (`send.ts`).
- **Quiet hours** `src/lib/comms/hours.ts` 9am–8pm recipient-local floor.
- **is_security firewall** `src/lib/compliance/firewall.ts` + gate step 6; securities threads never auto-reply.
- **Twilio inbound signature verification** `src/lib/comms/twilio.ts` — constant-time; rejects in production.

## Human-action items (cannot be completed by this frontend initiative)

1. **Standardize consent copy** to the `SiteContactForm` bar across `PublicForm`, `PublicReferForm`, and the workshop forms (brand, recurring automated, Msg&data rates, STOP/HELP, Privacy + SMS Terms links). **→ legal review of wording.**
2. **`/refer` chrome** — wrap in `PublicPage`/`PublicFooter` (or add `(public)/layout.tsx`) so Privacy + SMS Terms links render; add the `/sms-terms` link to its CTA. Structural fix is dev-side; **the consent copy is legal-review.**
3. **`/[slug]` agency referral** — decide whether it triggers SMS; if yes a full consent CTA + footer links are required. **→ legal.**
4. **Workshop forms** — add a guaranteed static SMS-disclosure fallback independent of `sms_disclosure`.
5. **TRAIGA consent-point disclosure** — add AI-interaction disclosure into consent UX where forms feed AI/automated messaging. **→ Ryan Anderson / legal to approve exact TRAIGA language.**
6. **A2P 10DLC brand + campaign registration** in GHL/Twilio with Privacy + SMS Terms URLs populated; set `NEXT_PUBLIC_SMS_FROM` to the approved campaign number (currently falls back to office number — `src/lib/site.ts` ~55-63). Console task, not code.
7. **Confirm HELP auto-response** wired to an approved reply.
8. **Referrer-consents-for-third-party-number** design (`/refer`, `/[slug]`) — **→ legal / Ryan Anderson sign-off** before any SMS to referred numbers.

## Merge policy note (§12.5)

Every consent-copy or legal-page-wording change in items 1–5/8 is
carrier-reviewable, legally binding text. Any slice touching it **must stop for
human legal + Ryan Anderson sign-off before merge** and **may not auto-merge
regardless of CI status.** Structural/chrome fixes (footer wrapping, static
fallback scaffolding) are dev-side but should ship in the same reviewed slice as
the copy they frame.
