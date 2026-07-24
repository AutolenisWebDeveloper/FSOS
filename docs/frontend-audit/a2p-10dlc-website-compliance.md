# A2P 10DLC / TCPA / TRAIGA — Website Compliance Report

> **Scope:** the public website surface that carriers and The Campaign Registry
> review when approving A2P 10DLC SMS campaigns (messaging path: Twilio via
> GoHighLevel). Frontend audit only — no backend/dispatcher changes.
> **Authority:** `twilio-a2p-compliance` skill wins on any conflict.
> **Status date:** 2026-07-22. **Verified against the live repo, read-only.**
>
> **No approval gate.** No page or copy requires a named individual's prior
> sign-off to go live — the FSA owns publish. The goal is a site that is
> **accurate and compliant by construction** with applicable law, carrier /
> Twilio A2P 10DLC requirements, and best practice. Where content may present a
> regulatory/legal/carrier risk, this report **documents it and recommends the
> compliant change** — it never treats a page as blocked pending someone's
> approval. Business-specific values (exact figures, IDs, addresses) are left as
> `[[FSA TO PROVIDE]]` placeholders for the FSA to confirm, not as gates.

## Executive summary

The core carrier-reviewable pages are **present and compliant**: the Privacy
Policy carries the required no-third-party-sharing SMS clause (the #1 rejection
cause), and the SMS Terms / Terms of Use pages carry the full program
disclosure. The homepage consultation form (`SiteContactForm`) is a
**gold-standard, un-prechecked opt-in CTA**. The remaining gaps are (a)
**inconsistent consent copy across the five phone-collection forms**, (b) the
`/refer` page missing its legal footer, and (c) the **TRAIGA AI-interaction
disclosure not surfaced at the point of consent** (only in the outbound message
body). The fix is to **bring the weaker forms up to the already-compliant
`SiteContactForm` standard** and add the missing footer/disclosure — accurate,
carrier-ready copy written directly against the `twilio-a2p-compliance`
checklist, with `[[FSA TO PROVIDE]]` placeholders only where a real
business-specific value is required. No approver gate.

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

- **13-step gate** `src/lib/comms/gate.ts` (`../data-guardrails.md` §5) — ordered, blocks on first failure, escalates.
- **STOP/HELP** `src/lib/comms/keywords.ts` + `inbound.ts applyOptOut` (revokes consent + inserts `dnc_entries` on STOP). ⚠️ **Confirm an explicit approved HELP auto-reply** is emitted — `processInbound` branches `stop`/`start` explicitly; `help` falls through to auto-reply/escalate (carriers test HELP).
- **Consent capture/storage** `consents` upsert; forms post `consent_sms`/`consent_email`; `workshop_consent_events`.
- **DNC suppression** `dnc_entries` + gate step 3, re-checked at send (`send.ts`).
- **Quiet hours** `src/lib/comms/hours.ts` 9am–8pm recipient-local floor.
- **is_security firewall** `src/lib/compliance/firewall.ts` + gate step 6; securities threads never auto-reply.
- **Twilio inbound signature verification** `src/lib/comms/twilio.ts` — constant-time; rejects in production.

## Remediation items (implement in Slice 1 — no approval gate)

Claude writes the accurate, carrier-ready copy directly against the
`twilio-a2p-compliance` checklist; `[[FSA TO PROVIDE]]` marks only real
business-specific values the FSA confirms.

1. **Standardize consent copy** to the `SiteContactForm` bar across `PublicForm`, `PublicReferForm`, and the workshop forms (brand, recurring automated, Msg&data rates, STOP/HELP, Privacy + SMS Terms links).
2. **`/refer` chrome** — wrap in `PublicPage`/`PublicFooter` (or add `(public)/layout.tsx`) so Privacy + SMS Terms links render; add the `/sms-terms` link to its CTA.
3. **`/[slug]` agency referral** — decide whether it triggers SMS; if yes, add a full consent CTA + footer links. (The referrer-consents-for-a-third-party-number design is a genuine TCPA question — see item 8 — surfaced as a recommendation, not a blocker.)
4. **Workshop forms** — add a guaranteed static SMS-disclosure fallback independent of the DB `sms_disclosure` field so consent copy is never empty.
5. **TRAIGA consent-point disclosure** — add the AI-interaction disclosure into the consent UX where forms feed AI/automated messaging.

### External / FYI (not code, not an approval gate)

6. **A2P 10DLC brand + campaign registration** in GHL/Twilio with the live Privacy + SMS Terms URLs; set `NEXT_PUBLIC_SMS_FROM` to the approved campaign number (currently falls back to office number — `src/lib/site.ts` ~55-63). Console task the FSA performs.
7. **Confirm HELP auto-response** is wired to an approved reply (carriers test HELP).
8. **Referrer-consents-for-third-party-number** (`/refer`, `/[slug]`) — a real TCPA design question the FSA should resolve before SMS is sent to *referred* numbers. **Documented as a risk + recommendation; not a page-deployment gate.**

## Merge policy note

Website copy and legal pages ship **compliant-by-construction** — no page or
consent-copy change is gated behind a named individual's sign-off. The audit's
job is to make the copy accurate and carrier-ready and to **document any residual
risk with a recommendation** (e.g. the third-party-number consent question in
item 8) so the FSA can act on it. Auto-merge follows the general §12 policy: CI
green + frontend-only diff + a11y/responsive evidence + no blocking review
findings. The one control that is genuinely separate — **activating automated SMS
*outreach* (actually sending texts)** — lives in the backend comms gate and is
out of scope for this frontend initiative; it is unchanged here.
