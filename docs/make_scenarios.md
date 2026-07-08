# FSOS — Make.com Scenario Configuration

These are **configuration instructions**, not code. Build each scenario in Make.com
exactly as specified. Project URLs:

- App: `https://fsos-seven.vercel.app`
- Supabase REST: `https://ynxaqeejjmeilpwmuuie.supabase.co`

Secrets referenced below (`[SUPABASE_SERVICE_KEY]`, `[FSOS_API_SECRET]`) live in your
Make.com connection/keychain — never paste raw values into module bodies.

> **Internal API auth.** Internal FSOS API routes now require an auth header. Any
> HTTP module that POSTs/GETs/PATCHes an `/api/...` internal route (e.g.
> `/api/customers/upsert`, `/api/gdc/cases`, `/api/dashboard`) MUST send:
>
> ```
> Authorization: Bearer [FSOS_API_SECRET]
> ```
>
> The public token/webhook routes (`/api/forms/submit`, `/api/agencies/referral`,
> `/api/agencies/upload`, `/api/webhooks/calendly`) do **not** need this header.

---

## Scenario 1 — APEX CSV Import

Loads the nightly APEX policy export into `customers` / `policies`.

```
Trigger: Google Drive → Watch Files in Folder
  Folder: FSOS/APEX_Exports/
  Watch: New files only

Module 2: CSV → Parse CSV
  File: from trigger output
  Has headers: Yes

Module 3: Iterator (loops each row)

Module 4: HTTP → POST
  URL: https://fsos-seven.vercel.app/api/customers/upsert
  Method: POST
  Headers:
    Content-Type: application/json
    Authorization: Bearer [FSOS_API_SECRET]
  Body: {
    "first_name": "{{first_name}}",
    "last_name": "{{last_name}}",
    "email": "{{email}}",
    "phone": "{{phone}}",
    "policy_type": "{{policy_type}}",
    "face_amount": "{{face_amount}}",
    "annual_premium": "{{annual_premium}}",
    "conversion_deadline": "{{conversion_deadline}}",
    "issue_date": "{{issue_date}}",
    "source": "apex"
  }

Error handling: Continue on error (single bad rows must not stop the batch)
```

The endpoint returns `{ success, customer_id, action }`. A bad row returns HTTP 400
with `{ success: false, error }` and never a 500, so the iterator continues.

---

## Scenario 2 — Nightly Score Sync (retired)

> **Retired.** This scenario used to push pipeline scores into GHL contact custom
> fields. GHL has been removed from the stack, so there is no CRM to sync scores
> to. Scores are read directly from the command center via `GET /api/scores` and
> from Supabase `scores`. Delete this scenario, or repurpose it: if you later want
> outbound follow-ups on high scores, retarget it to a direct Twilio SMS send or a
> Retell AI outbound call instead of a GHL contact update.

---

## Scenario 3 — 7AM Daily Briefing Snapshot

Stores the morning dashboard snapshot into `daily_briefings`.

```
Trigger: Schedule → Daily at 7AM CT

Module 2: HTTP → GET
  URL: https://fsos-seven.vercel.app/api/dashboard
  Headers:
    Authorization: Bearer [FSOS_API_SECRET]

Module 3: HTTP → POST (store briefing in Supabase)
  URL: https://ynxaqeejjmeilpwmuuie.supabase.co/rest/v1/daily_briefings
  Method: POST
  Headers:
    apikey: [SUPABASE_SERVICE_KEY]
    Authorization: Bearer [SUPABASE_SERVICE_KEY]
    Content-Type: application/json
    Prefer: resolution=merge-duplicates
  Body: {
    "briefing_date": "{{formatDate(now; 'YYYY-MM-DD')}}",
    "urgent_conversions": "{{counts.urgent_conversions}}",
    "appointments_today": "{{counts.appointments}}",
    "new_referrals": "{{counts.new_referrals}}",
    "opra_due": "{{counts.opra_due}}",
    "pipeline_gdc": "{{gdc.pipeline}}",
    "issued_gdc_ytd": "{{gdc.issued_ytd}}"
  }
```

`Prefer: resolution=merge-duplicates` upserts on the unique `briefing_date`, so
re-running the scenario for the same day overwrites rather than duplicates.

> **Note on `counts.appointments`.** The `/api/dashboard` response includes a
> `counts.appointments` field, but nothing currently populates appointment data,
> so it returns `0` until appointment ingestion is wired up (e.g. from the
> Calendly webhook). Store it as-is; it will begin reflecting real numbers once
> that pipeline exists.

---

## Scenario 4 — Commission Case Auto-Create (Calendly / manual trigger)

Creates a `commission_cases` row when an application is submitted. GHL pipelines
no longer exist, so trigger this from whatever now signals "application submitted"
— a Make.com webhook you fire manually, an incoming Calendly `invitee.created`
event, or a Google Sheet/form row.

```
Trigger: Webhook (fired when an application is submitted)

Module 2: HTTP → GET (find customer in Supabase)
  URL: https://ynxaqeejjmeilpwmuuie.supabase.co/rest/v1/customers
  Query: ?email=eq.{{contact.email}}&select=customer_id
  Headers: apikey + Authorization with SUPABASE_SERVICE_KEY

Module 3: HTTP → POST (create commission case)
  URL: https://fsos-seven.vercel.app/api/gdc/cases
  Method: POST
  Headers:
    Content-Type: application/json
    Authorization: Bearer [FSOS_API_SECRET]
  Body: {
    "customer_id": "{{customer_id}}",
    "carrier": "{{carrier}}",
    "product_name": "{{product}}",
    "product_type": "{{product_type}}",
    "premium": "{{premium}}",
    "pipeline": "{{pipeline}}"
  }
```

The endpoint runs `calculate_case_gdc()` server-side, so the case is created with
the estimated GDC/FSA already populated.
