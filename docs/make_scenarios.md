# FSOS — Make.com Scenario Configuration

These are **configuration instructions**, not code. Build each scenario in Make.com
exactly as specified. Project URLs:

- App: `https://fsos-seven.vercel.app`
- Supabase REST: `https://ynxaqeejjmeilpwmuuie.supabase.co`

Secrets referenced below (`[SUPABASE_SERVICE_KEY]`, `[GHL_API_KEY]`) live in your
Make.com connection/keychain — never paste raw values into module bodies.

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
  Headers: Content-Type: application/json
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

## Scenario 2 — Nightly Score Push to GHL

Pushes each customer's pipeline scores into GHL contact custom fields.

```
Trigger: Schedule → Daily at 2:30AM CT

Module 2: HTTP → GET
  URL: https://ynxaqeejjmeilpwmuuie.supabase.co/rest/v1/scores
  Headers:
    apikey: [SUPABASE_SERVICE_KEY]
    Authorization: Bearer [SUPABASE_SERVICE_KEY]
  Query: ?select=*,customers(email,first_name,last_name)&scored_at=gte.[yesterday]&limit=500

Module 3: Iterator

Module 4: HTTP → GET (find GHL contact by email)
  URL: https://services.leadconnectorhq.com/contacts/search?email={{email}}
  Headers: Authorization: Bearer [GHL_API_KEY]

Module 5: HTTP → PUT (update GHL contact custom fields)
  URL: https://services.leadconnectorhq.com/contacts/{{ghl_contact_id}}
  Body: {
    "customField": {
      "fsa_opra_score": "{{opra_score}}",
      "fsa_conversion_score": "{{conversion_score}}",
      "fsa_life_score": "{{life_score}}",
      "fsa_retirement_score": "{{retirement_score}}",
      "fsa_primary_pipeline": "{{primary_pipeline}}",
      "fsa_scored_at": "{{scored_at}}"
    }
  }
```

---

## Scenario 3 — 7AM Daily Briefing Snapshot

Stores the morning dashboard snapshot into `daily_briefings`.

```
Trigger: Schedule → Daily at 7AM CT

Module 2: HTTP → GET
  URL: https://fsos-seven.vercel.app/api/dashboard

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

---

## Scenario 4 — GHL Pipeline → Commission Case Auto-Create

Creates a `commission_cases` row when a GHL opportunity reaches
"Application Submitted".

```
Trigger: Webhook (GHL sends to Make.com webhook URL when stage changes)
Event filter: pipelineStage.name = "Application Submitted"

Module 2: HTTP → GET (find customer in Supabase)
  URL: https://ynxaqeejjmeilpwmuuie.supabase.co/rest/v1/customers
  Query: ?email=eq.{{contact.email}}&select=customer_id
  Headers: apikey + Authorization with SUPABASE_SERVICE_KEY

Module 3: HTTP → POST (create commission case)
  URL: https://fsos-seven.vercel.app/api/gdc/cases
  Body: {
    "customer_id": "{{customer_id}}",
    "carrier": "{{opportunity.fsa_carrier}}",
    "product_name": "{{opportunity.fsa_product}}",
    "product_type": "{{opportunity.fsa_product_type}}",
    "premium": "{{opportunity.monetaryValue}}",
    "pipeline": "{{determinePipelineFromOpportunityName}}",
    "ghl_opportunity_id": "{{opportunity.id}}"
  }
```

The endpoint runs `calculate_case_gdc()` server-side, so the case is created with
the estimated GDC/FSA already populated.
