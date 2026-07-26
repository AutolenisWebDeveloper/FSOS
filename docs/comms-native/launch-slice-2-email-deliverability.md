# Launch Slice 2 — Email Deliverability

**Status:** Code complete + tested. Live domain verification + seed send = **operator handoff** (see §4).
**Date:** 2026-07-26
**Unblocks:** live marketing email for Cross-Sell Life, Life Conversion, Win-Back Life (email has no carrier dependency; it can send the moment the Resend domain is verified).

This slice makes marketing email **CAN-SPAM-compliant and deliverable**. It does not rebuild the engine, gate, or providers — it fills the deliverability gaps the Slice 1 audit found.

---

## 1. What shipped (code)

| Area | Change | Files |
|---|---|---|
| **CAN-SPAM footer** | Every marketing email now carries the FSA's physical mailing address + a per-recipient unsubscribe link, in **both HTML and plaintext**. | `src/emails/_layout.tsx` |
| **Unsubscribe token** | `{{unsubscribe_url}}` merge token, injected per recipient by the email send path; safe `/unsubscribe` fallback. | `src/lib/comms/personalize.ts`, `src/lib/comms/send.ts` |
| **Reply-To** | Marketing email sets `Reply-To` to a monitored inbox (`RESEND_REPLY_TO`, default `CONTACT.email`). | `src/lib/messaging.ts`, `src/lib/comms/dispatcher.ts` |
| **List-Unsubscribe (RFC 8058)** | One-click `List-Unsubscribe` + `List-Unsubscribe-Post` headers on every marketing email (Gmail/Yahoo bulk-sender requirement). | `src/lib/comms/unsubscribe-core.ts`, `unsubscribe.ts`, `dispatcher.ts` |
| **Real suppression** | Unsubscribe (human page **and** one-click) writes the **enforced** `dnc_entries` store the gate reads at send time — an opt-out actually stops future sends. Single shared path (§6). | `src/lib/comms/unsubscribe.ts`, `src/app/api/comms/unsubscribe/route.ts`, `src/app/api/consent/opt-out/route.ts` |
| **One-click abuse guard** | The public one-click endpoint requires an HMAC-signed token (`UNSUBSCRIBE_SECRET`) so it can't be used to suppress arbitrary contacts. | `unsubscribe-core.ts` |
| **Prefilled page** | `/unsubscribe?c=&ch=` prefills contact + channel from the emailed link / one-click redirect. | `src/app/unsubscribe/page.tsx`, `src/components/pages/Unsubscribe.tsx` |
| **Plaintext alongside HTML** | Already present (ADR-025 stored `body_text`); confirmed threaded end to end. | — |

**Tests:** `tests/comms-email-deliverability.test.mjs` (HMAC sign/verify, URL building, RFC 8058 headers, `unsubscribe_url` token) and strengthened `tests/email-determinism.test.mjs` (every template now must carry the CAN-SPAM unsubscribe + physical address in HTML **and** plaintext, and still no baked-in SMS opt-out). `build`, `type-check`, `lint` all clean.

> **Re-approval note (ADR-025).** Adding the footer changes every email template's rendered bytes, so `npm run templates:build` will bump `render_sha` and reset those templates to `draft`. That is expected — templates are (re)authored + approved in Slice 4 before any campaign uses them.

---

## 2. The single live gate: verify the Resend sending domain (DNS)

Live email sends the moment a Resend domain is **verified** and `RESEND_FROM_EMAIL` is an address on it. Do this in the Resend dashboard for the FSA's sending domain (e.g. `mail.markistfsa.com` or `markistfsa.com`):

1. **Resend → Domains → Add Domain.** Enter the sending domain. Resend generates the exact records below (DKIM key + selector are **unique per domain — copy the literal values Resend shows**; do not invent them).
2. Add these DNS records at the domain's DNS host, then click **Verify** in Resend:

   | Purpose | Type | Host / Name | Value |
   |---|---|---|---|
   | **DKIM** | `TXT` (or `CNAME` for the shared-IP flow) | `resend._domainkey` (selector as shown) | the `p=...` public key Resend displays |
   | **SPF** (Return-Path) | `TXT` | `send` (the Resend subdomain shown) | `v=spf1 include:amazonses.com ~all` |
   | **MX** (Return-Path) | `MX` | `send` | `feedback-smtp.<region>.amazonses.com` (priority 10) |
   | **DMARC** | `TXT` | `_dmarc` | `v=DMARC1; p=none; rua=mailto:dmarc@<domain>; adkim=r; aspf=r` |

   - Start DMARC at `p=none` (monitor), tighten to `p=quarantine` then `p=reject` after a week of clean aggregate reports.
   - Use a **subdomain** (e.g. `mail.` or `send.`) for marketing so it doesn't affect the root domain's reputation.
3. When Resend shows the domain **Verified** (SPF + DKIM green), set the env vars (§3) and send the seed test (§4).

`sendEmail` already **fails closed** if `RESEND_FROM_EMAIL` is unset or still contains `yourdomain.com`, so a placeholder sender can never leak a live send.

---

## 3. Environment (production)

Set in Vercel (Production + Preview) — see `.env.local.example`:

| Var | Value |
|---|---|
| `RESEND_API_KEY` | Resend API key |
| `RESEND_FROM_EMAIL` | an address **on the verified domain**, e.g. `hello@mail.markistfsa.com` (not `*yourdomain.com`) |
| `RESEND_REPLY_TO` | monitored reply inbox (defaults to `CONTACT.email` if unset) |
| `UNSUBSCRIBE_SECRET` | long random string (signs one-click unsubscribe URLs; falls back to `RESEND_WEBHOOK_SECRET`) |
| `NEXT_PUBLIC_SITE_URL` | canonical site origin (used to build unsubscribe URLs) |

---

## 4. Seed test + inbox placement (operator handoff)

These require authenticated provider/DB access and are **not runnable from the non-interactive build session** (the Supabase, Twilio, and Resend connectors need re-authorization). Run them once the domain is verified:

1. **Send a real seed email** to a Gmail + an Outlook address (via the FSA email tools once `RESEND_FROM_EMAIL` is live, or a temporary `/api/comms/send` internal call).
2. In Gmail: **Show original** → confirm **SPF: PASS, DKIM: PASS, DMARC: PASS**, and that the message lands in **Primary/Inbox, not Spam**.
3. Confirm the footer renders: physical address + a working **Unsubscribe** link; click it and confirm the `/unsubscribe` page loads prefilled and the opt-out is recorded (a `dnc_entries` row appears).
4. Confirm the raw headers show `List-Unsubscribe` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, and that Reply-To is the monitored inbox.
5. If any of SPF/DKIM/DMARC is not PASS, re-check the DNS records in §2 (propagation can take up to a few hours).

Once §2–§4 are green, email is production-ready; Slice 6 enrolls the real audiences and activates the email steps.
