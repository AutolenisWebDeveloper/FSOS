---
name: fsos-dns-auth
description: >
  Author and validate the email-authentication DNS records for FSOS's sending domains — SPF, DKIM, DMARC,
  ARC, BIMI, and MX — for the transactional (notify.markistfsa.com), marketing (mail.markistfsa.com), and
  personal (markistfsa.com) identities on Resend + Google Workspace. Use this whenever the task is setting
  up or fixing domain authentication, DKIM selectors, an SPF record hitting the 10-DNS-lookup limit, DMARC
  alignment, the DMARC p=none→quarantine→reject ramp, BIMI/VMC readiness, or MX records, or when you need to
  validate what is actually published in DNS. It ships a self-contained validation script (validate_dns.mjs)
  that resolves and grades SPF, DKIM (by selector), DMARC, and MX for a given domain and flags misconfig —
  multiple SPF records, >10 lookups, missing/misaligned DKIM, DMARC still at p=none. Reach for it even when
  the user just says "set up SPF and DKIM for our Resend domain", "why does DMARC fail even though DKIM
  passes", "check our DNS records", "are we ready for a BIMI logo", or "add the DMARC record" — so alignment
  and the lookup limit are handled correctly. It reads only public DNS and takes no secrets. Not for template
  content (fsos-email-template-qa) or overall deliverability strategy (fsos-deliverability).
---

# FSOS DNS Authentication — SPF · DKIM · DMARC · ARC · BIMI · MX

Email authentication is how a receiving server proves a message really came from the domain it claims. Three
records do the heavy lifting — **SPF** (which servers may send), **DKIM** (a cryptographic signature), and
**DMARC** (what to do when SPF/DKIM fail, plus *alignment*). Get these right and aligned and you clear the
single biggest structural barrier to the inbox. Get alignment subtly wrong and mail authenticates yet still
fails DMARC — the most common and most confusing failure. This skill authors the records and ships a script
to prove what's actually published.

For provider-agnostic theory, the org's reference-only `twilio-sendgrid-account-setup` and
`twilio-compliance-traffic` skills cover the same concepts — but FSOS sends via **Resend** (email) and
**Google Workspace** (personal), **not SendGrid**. The SendGrid API/dashboard/whitelabel wizard does not
apply; translate the concepts to the Resend/Workspace records below.

## The three FSOS identities and their records

| Identity | Subdomain | Sender | SPF include | DKIM | DMARC |
|---|---|---|---|---|---|
| Transactional | `notify.markistfsa.com` | Resend | Resend's published include | Resend selector(s), `d=notify.markistfsa.com` | inherits/`_dmarc.notify` |
| Marketing | `mail.markistfsa.com` | Resend Broadcasts | Resend's published include | Resend selector(s), `d=mail.markistfsa.com` | inherits/`_dmarc.mail` |
| Personal 1:1 | `markistfsa.com` | Google Workspace | `include:_spf.google.com` | Google `google` selector | `_dmarc.markistfsa.com` (org policy) |

> **Config default — verify (§4.3):** the exact SPF `include:` host and DKIM selector strings are issued by
> Resend **per domain in its dashboard** — copy them from there, do **not** hardcode a guessed include or
> selector. The script below reports what's *published*; Resend's dashboard is the source of truth for what
> *should* be published. Never invent a DKIM selector or SPF include that Resend hasn't given you.

---

## 1. SPF — one record per (sub)domain, ≤10 DNS lookups

SPF is a single TXT record at the domain root listing authorized senders. Two hard rules:

- **Exactly one `v=spf1` record per (sub)domain.** Two SPF records = a permerror = SPF fails entirely.
  When adding a sender, **merge into the existing record**, never publish a second one.
- **≤10 DNS-lookup mechanisms** (`include`, `a`, `mx`, `ptr`, `exists`, `redirect`). Exceeding 10 = permerror.
  Each `include:` can chain further lookups, so nested includes blow the budget fast. `ip4:`/`ip6:`/`all` cost 0.

Per-stream examples (illustrative — use Resend's actual published include):

```
; notify.markistfsa.com  (transactional, Resend)
notify.markistfsa.com.  TXT  "v=spf1 include:<resend-published-include> -all"

; mail.markistfsa.com    (marketing, Resend Broadcasts)
mail.markistfsa.com.    TXT  "v=spf1 include:<resend-published-include> -all"

; markistfsa.com         (personal, Google Workspace)
markistfsa.com.         TXT  "v=spf1 include:_spf.google.com ~all"
```

Prefer `-all` (hardfail) on the dedicated sending subdomains once verified; `~all` (softfail) is acceptable
on the human Workspace domain during transition. **SPF authenticates the envelope/Return-Path domain, which
Resend controls — so SPF alignment is not your lever; DKIM alignment is (see §3).**

## 2. DKIM — Resend signs; align `d=` to the From subdomain

Resend publishes DKIM as CNAME (or TXT) records under the sending subdomain and signs each message with a
**1024-bit** key. DKIM's job for DMARC is *alignment*: the signature's `d=` domain must match the `From:`
subdomain. Because each stream sends from its own subdomain and Resend signs with `d=` on that same
subdomain, **relaxed DMARC alignment passes automatically** — provided you didn't cross the streams (e.g.
sending marketing mail with a `notify.` From but a `mail.` signature).

Publish exactly the CNAME/TXT records Resend's dashboard lists for each verified subdomain, then confirm the
domain shows **Verified** in Resend before sending.

## 3. Alignment — the failure that hides behind `dkim=pass`

DMARC passes when **at least one** of SPF or DKIM both *passes* **and** is *aligned* with the `From:` domain
(relaxed = same organizational domain; strict = exact). The trap: `dkim=pass` on the wrong `d=` still fails
DMARC. Always read `Authentication-Results` and confirm the `d=` matches the visible `From:` subdomain — not
just that a pass exists. **Reply-To may point at the Workspace mailbox (`replyToAddress()` in
`unsubscribe.ts`); Reply-To is not authenticated and does not affect DMARC alignment** — a common false alarm.

## 4. DMARC — publish, then ramp `p=none → quarantine → reject`

DMARC is a TXT record at `_dmarc.<domain>` telling receivers what to do with unaligned mail and where to send
aggregate reports. **Ramp gradually, gated on clean aggregate (RUA) reports** — jumping straight to `reject`
can blackhole legitimate mail you didn't know about.

```
; Step 1 — MONITOR ONLY (collect reports, enforce nothing)
_dmarc.markistfsa.com.  TXT  "v=DMARC1; p=none; rua=mailto:dmarc-reports@markistfsa.com; fo=1; adkim=r; aspf=r"

; Step 2 — after RUA reports show all legit streams aligned for ~2–4 weeks
_dmarc.markistfsa.com.  TXT  "v=DMARC1; p=quarantine; pct=100; rua=mailto:dmarc-reports@markistfsa.com; adkim=r; aspf=r"

; Step 3 — after quarantine is clean
_dmarc.markistfsa.com.  TXT  "v=DMARC1; p=reject; rua=mailto:dmarc-reports@markistfsa.com; adkim=r; aspf=r"
```

Ramp rule: **advance a level only when RUA reports show every legitimate stream passing aligned** for a
sustained window. `p=none` left in place indefinitely is a finding — it means DMARC is published but enforcing
nothing (spoofers are not blocked). `adkim=r`/`aspf=r` (relaxed) is correct for FSOS's subdomain-per-stream setup.

> **Config default — verify (§4.3):** the `rua` mailbox and the 2–4 week dwell time are conservative defaults —
> confirm the real reports mailbox exists and adjust dwell to the volume of RUA data actually arriving.

## 5. ARC & BIMI — notes (ARC = awareness; BIMI = future)

- **ARC** (Authenticated Received Chain) preserves the original auth result across intermediaries (mailing
  lists, forwarders) that would otherwise break DKIM/SPF. Resend/Google handle ARC on their side; FSOS
  publishes no ARC record. Relevance: if forwarded mail fails DMARC but direct mail passes, ARC/forwarding is
  the cause — not your records.
- **BIMI** (Brand Indicators for Message Identification) displays the FSA/Farmers logo in the inbox. **BIMI is
  future work with two hard prerequisites:** (1) DMARC at **enforcement** (`p=quarantine` or `p=reject`, not
  `p=none`) — so it depends on the §4 ramp completing, and (2) for Gmail/Apple, a **VMC** (Verified Mark
  Certificate) or CMC, which requires a **registered trademark**. Farmers brand assets are trademarked but
  **licensing/authority to certify the mark for BIMI is unverified** — treat BIMI as blocked until DMARC
  enforcement is live *and* the mark/VMC path is confirmed with the brand owner. Do not publish a BIMI record
  or claim inbox-logo support before both are true (§4.3, §17 trademark handling).

## 6. MX — receiving, not sending

MX records route inbound mail. `markistfsa.com` uses Google Workspace MX. Dedicated **sending** subdomains
(`notify.`, `mail.`) typically need **no MX for sending** — but some receivers look more favorably on a
sending domain that can also receive, and DMARC RUA replies need a deliverable mailbox somewhere. Don't add
MX to a send-only subdomain unless you intend it to receive; do ensure the root domain's MX is healthy so
bounce/report mail isn't lost.

---

## 7. Validate what's actually published — `validate_dns.mjs`

Never trust the dashboard's "should be" over what DNS actually returns. The bundled script resolves the live
records over **public DNS-over-HTTPS** (no secrets, no `.env`, no local resolver assumptions) and grades them.

```bash
# Full check (SPF + DKIM + DMARC + MX). Pass DKIM selectors you expect (comma-separated).
node .claude/skills/fsos-dns-auth/scripts/validate_dns.mjs notify.markistfsa.com --selectors=resend
node .claude/skills/fsos-dns-auth/scripts/validate_dns.mjs mail.markistfsa.com   --selectors=resend
node .claude/skills/fsos-dns-auth/scripts/validate_dns.mjs markistfsa.com        --selectors=google

# JSON output (for piping / CI-style checks)
node .claude/skills/fsos-dns-auth/scripts/validate_dns.mjs notify.markistfsa.com --selectors=resend --json
```

It flags: **multiple SPF records**, **>10 SPF lookups** (counting nested includes), **missing/unaligned
DKIM** for each expected selector, **missing DMARC**, and **DMARC still at `p=none`** (published but not
enforcing). Exit code is non-zero when any hard failure is found, so it doubles as a pre-send gate.

**Interpreting results → next step:** SPF/DKIM/DMARC failures are DNS edits (this skill). If records are all
green but mail still lands in spam/Promotions, authentication is not your problem — go to
`fsos-email-template-qa` (content) or `fsos-deliverability` (reputation/engagement).

This skill edits **DNS only** — no application code, no `src/**`. The FSOS send path already carries the RFC
8058 unsubscribe header (`unsubscribe.ts`); DNS is the layer this skill owns.
