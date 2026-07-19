# FSOS ↔ GoHighLevel Integration

How the FSOS command center connects to the **Markist Athelus Agency** GHL
sub-account (`ATDNO1e5d27nj5t8vId3`) so the GHL email/SMS/automation program
(WF-0 → WF-43) runs against FSOS data and pipeline moves flow back into Supabase.

GHL is **additive** — Calendly (booking), Twilio (direct SMS), and Resend
(email) remain in place. GHL owns the **pipelines, opportunities, and the
nurture/automation workflows**; FSOS remains the system of record for scoring,
commissions, and forms.

---

## 1. Wiring

| Direction | Surface | What it does |
|-----------|---------|--------------|
| FSOS → GHL | `src/lib/ghl.ts` | Authoritative pipeline/stage ID map + REST client (LeadConnector v2). |
| FSOS → GHL | `POST /api/ghl/sync` (internal) | Upsert a customer as a GHL contact and open/move its opportunity at a named stage. |
| FSOS → GHL | `POST /api/agencies/referral` | On a new agency referral, upserts the contact + opens a *Prospect / Client → New Opportunity* and tags `src-referral`. Best-effort, guarded. |
| GHL → FSOS | `POST /api/webhooks/ghl` | Parses opportunity stage changes, contact create/update, appointments, and opt-outs; resolves stages via the ID map; creates commission cases at *Application Submitted*, marks *Issued*. |

All GHL writes **no-op when `GHL_API_KEY` is unset**, so the app runs unchanged
without GHL configured.

### Environment

```
GHL_API_KEY=…            # Private Integration token: contacts.write, opportunities.write, conversations.write
GHL_LOCATION_ID=ATDNO1e5d27nj5t8vId3
GHL_WEBHOOK_SECRET=…     # HMAC-SHA256 shared secret for x-ghl-signature
```

### Database

Run `supabase/migrations/002_ghl_integration.sql` — adds `ghl_contact_id`,
`ghl_opportunity_id`, `ghl_stage_id`, `ghl_pipeline_id` to `customers`,
`ghl_opportunity_id` to `commission_cases`, and `ghl_activity_id` to `activity`,
with the indexes the webhook uses for idempotent upserts.

### Inbound webhook setup (GHL)

Add a **Webhook** action in the relevant GHL workflows (or a global webhook)
pointing at `https://<domain>/api/webhooks/ghl`, signing the raw body with
`GHL_WEBHOOK_SECRET` into `x-ghl-signature`. The parser keys off the event type
substring (`opportunity`, `contact`, `appointment`, `dnd`/`optout`).

---

## 2. Authoritative Pipeline + Stage ID map (binding contract)

Location `ATDNO1e5d27nj5t8vId3`. **Verified live 2026-07-08** — counts and order
match. This map is encoded in `src/lib/ghl.ts`; every stage-move action and the
webhook parser depend on these exact IDs.

### Pipeline A — Prospect / Client → `nuOBjRl27uhinHChdqfH`
| Pos | Stage | Stage ID |
|----|-------|----------|
| 1 | New Opportunity | `8681cb03-c6d6-4803-8227-2ac4802f4bf4` |
| 2 | Contacted | `9f50bd51-bb1a-4f38-a891-e51f593c3588` |
| 3 | Appointment Scheduled | `a66eee40-cac1-47e1-8365-1266074eb63a` |
| 4 | Appointment Completed | `e6b0b2d6-25dc-43a4-b687-c83c946e0371` |
| 5 | Fact-Finder Completed | `a7d8efda-3bbb-4a39-8a56-a3e0e2290fd1` |
| 6 | Recommendation Presented | `668c6a07-83ca-48db-8e33-7f4193b1ae8f` |
| 7 | **Application Submitted** | `f7be8411-c27e-4d67-9a73-5f4b048425ee` |
| 8 | **Issued** | `663763b9-b082-47d8-8c82-67342d49a823` |
| 9 | Annual Review Scheduled | `2bd09d9f-5a60-42b7-aa39-bc48dee37db1` |
| 10 | Referral Requested | `9a62ed59-8586-4d39-9886-63dc6ecaa49e` |

### Pipeline B — Agency Owner → `lIUaJLNxFwtCJPycw70h`
| Pos | Stage | Stage ID |
|----|-------|----------|
| 1 | Prospect Owner | `6304e715-90dc-43d3-a764-31424c861b28` |
| 2 | Pilot (90-day) | `48a460db-7229-4159-9a96-05813ede66af` |
| 3 | Active Partner | `2b592b9d-8650-41ec-8a09-6f5f1b472700` |
| 4 | Opportunity Handoff | `abe55df8-4e1e-4833-b11f-2bd18ab2f0f8` |
| 5 | Financial Assessment | `ec067c76-e905-4c89-b352-ed6d85e566ba` |
| 6 | Quick Wins | `51c0290e-2ebe-42af-98d5-993cfa79a0de` |
| 7 | Strategic Partner | `211e1646-b215-40a2-bcfb-601006db3763` |
| 8 | Dormant | `5077ae1f-5149-4f7d-ba39-2772edcb33f9` |

### Pipeline C — Term Conversions → `EGvOhkgRjUslNVXGX1Wp`
| Pos | Stage | Stage ID |
|----|-------|----------|
| 1 | Conversion Eligible Identified | `af3e3e02-30b8-4dd0-bbc5-7dcd6a59c4b8` |
| 2 | Window Notice Sent | `bd03e1cb-88de-4ccc-9b87-23ba33579545` |
| 3 | Review Scheduled | `0bebd4f9-2091-48ad-8d0b-5842b3d3cc5e` |
| 4 | Conversion Illustrated | `7a638d86-7302-4072-90e9-24ae8249dc30` |
| 5 | **Application Submitted** | `971271bb-8710-4a49-8e0d-f66cd6b899d5` |
| 6 | **Converted (Issued)** | `c718945e-f219-4b71-aae4-02b0d513f489` |

Pre-existing **Investment Marketing Pipeline** (`yTS0xcoKpCEZldhHQ2tM`) is out of
scope and intentionally not modeled.

---

## 3. Live account audit (2026-07-08)

Checked against the live location via the GHL API.

### ✅ Verified present & correct
- **Pipelines A/B/C** — all live, stage counts 10 / 8 / 6, order and IDs match the map above.
- **Custom fields** — all blueprint fields exist (Universal + agency-owner set),
  plus the Term-Conversion support fields (`term_conversion_eligible`,
  `conversion_deadline`, `conversion_score`, `policy_type_life`,
  `term_face_amount`). Field keys are mapped in `GHL_CUSTOM_FIELDS`
  (`src/lib/ghl.ts`) — note the live keys differ from the blueprint aliases,
  e.g. blueprint `referring_owner` → GHL `contact.referring_agency_owner`,
  `owner_agency` → `contact.owner_agency_name`, `contact_tz` →
  `contact.contact_timezone`, `appt_outcome` → `contact.appointment_outcome`,
  `owner_status` → `contact.partnership_status`, `dnc_crosssell` →
  `contact.do_not_crosssell`.

### ⚠️ Needs a manual fix in the GHL UI
1. **Life Stage picklist is broken.** The `contact.life_stage` field options are
   `young_family`, `established_family`, **`pre_retiree, retiree`** (one merged
   option), `business_owner`. The blueprint and **WF-0 Life-Stage Router** need
   `pre_retiree` (55–67 → WF-12c) and `retiree` (67+ → WF-12d) as **two separate
   options**. Fix: Settings → Custom Fields → Life Stage → replace the combined
   option with two distinct options `pre_retiree` and `retiree`. Until fixed,
   the retiree branch of WF-0 can never match.
2. **`lead_source` uses display labels, not snake keys.** Options are
   `Agency Referral`, `COI Referral`, `Event`, `Inbound Form`, `Inbound Landing`
   (blueprint listed `agency_referral`, `coi_referral`, …). FSOS writes the
   display label (`"Agency Referral"`) to match. Keep the two consistent — if you
   normalize to snake keys, update `GHL_CUSTOM_FIELDS` usage in the referral route.

### 🔍 Not verifiable via the API — confirm in the UI
The GHL integration surface exposes contacts, opportunities, conversations,
calendars (read), custom fields (read), and templates — **but not the Workflow
builder, tag list, custom values, forms, or calendars-as-config.** The following
must be confirmed manually in GHL; FSOS can't enumerate them:
- **Workflows WF-0 → WF-43** exist and are activated (and `[FFS APPROVAL]` steps
  left inactive until sign-off).
- **Tags** from §2 of the blueprint (`src-*`, `type-*`, `stage-*`, `int-*`,
  `owner-*`, consent tags, workflow-control tags) exist.
- **Custom Values** (`fsa_name`, `booking_link`, `compliance_footer`,
  `owner_assessment_form`, `factfinder_form`, …) are populated.
- **Forms** (Client Fact-Finder, Agency-Owner Financial Assessment) built and
  wired to the stage moves noted in the blueprint.
- **Go-live gate**: A2P 10DLC registered, sending window (9a–8p) set, consent
  fields wired, Ryan Anderson (Compliance TX) called — **before any live SMS**.

---

## 4. Stage-move + sync usage

```ts
import { stageAt, moveOpportunityStage, createOpportunity } from '@/lib/ghl'

// Resolve the exact stage id for Pipeline A → Application Submitted (pos 7)
stageAt('prospect_client', 7)   // → { id: 'f7be8411…', name: 'Application Submitted', position: 7 }
```

```bash
# Push an FSOS customer into GHL at Prospect / Client → Contacted (pos 2)
curl -X POST https://<domain>/api/ghl/sync \
  -H "Authorization: Bearer $FSOS_API_SECRET" -H "Content-Type: application/json" \
  -d '{ "customer_id": "…", "pipeline": "prospect_client", "stage": 2, "tags": ["nurture-active"] }'
```

---

## 5. CSV / Excel contact upload → GHL bulk import

Bulk-import a book of contacts from a **CSV or Excel (`.xlsx`)** file straight
into the GHL location. The workflow reads the document, **intelligently
recognizes which column is which**, validates, de-duplicates, maps fields,
upserts to GHL (so **no duplicate contact is ever created**), optionally drops
each contact onto a pipeline stage, and logs every batch for the audit trail.

**UI:** Command Center → sidebar → **Contact Upload** (`page==="upload"`), or the
**+ Upload Contacts to GHL** button on an Agency Owner's Upload History tab.

**API:** `POST /api/ghl/contacts/upload` (internal auth) — `multipart/form-data`:

| field      | required | notes                                                        |
| ---------- | -------- | ------------------------------------------------------------ |
| `file`     | yes      | `.csv` or `.xlsx`, ≤ 5 MB, ≤ 1,000 rows per import           |
| `tags`     | no       | comma-separated; merged onto every contact                   |
| `source`   | no       | lead source stamped on the batch + `lead_source` custom field |
| `agency_owner` | no   | referring agency owner → `referring_agency_owner` custom field; applied to any row missing its own Agency Owner column |
| `pipeline` | no       | `prospect_client` \| `agency_owner` \| `term_conversions`     |
| `stage`    | with pipeline | 1-based stage position (see the ID map in §1)           |
| `ai`       | no       | `false` disables AI column recognition for the request (default on when `ANTHROPIC_API_KEY` is set) |

### Intelligent column recognition

Columns are resolved by three strategies, in precedence order — the response's
`detection_method` records which one claimed each column:

1. **`header`** — exact header-alias match (`first name`, `e-mail`, `cell`, `owner`, …). Highest precision.
2. **`ai`** — when `ANTHROPIC_API_KEY` is set, Claude reads the headers **and a
   sample of the rows** and maps the remaining columns. This handles oddly named,
   non-English, or ambiguous headers by understanding the data the way a person would.
3. **`content`** — value-pattern inference for anything still unmapped: a column
   whose cells look like emails becomes `email`, E.164/US phones → `phone`, US
   states → `state`, 5-digit ZIPs → `postal_code`, two-word names → `full_name` —
   even when the header is `Column 3` or blank.

Recognized fields: `first_name` / `last_name` / `full_name`, `email`, `phone`,
`tags`, `source`, `agency_owner` → `referring_agency_owner`, `city`, `state`,
`postal_code`, `address`, `company`, `product_interest` & `life_stage` → custom
fields, `notes`. A name (full, or first + last) **and** at least one of
email/phone are required, or the request is rejected (422) with the columns it
did recognize so the operator can fix the file.

- **Validation** — emails are format-checked; phones are normalized to E.164
  (US 10-digit → `+1…`). Rows failing validation are marked `invalid` and skipped.
- **De-dupe** — within the file, the first occurrence of an email (or phone) wins;
  later collisions are marked `duplicate`. Against GHL, the contact is *upserted*
  (dedupe on email/phone per the location settings), never duplicated.
- **Retry** — each GHL call retries transient failures (network, 429, 5xx) with
  backoff; 4xx validation errors fail fast. Per-row `attempts` are logged.
- **Result** — counts for `success` / `duplicate` / `invalid` / `failed`, plus a
  downloadable CSV of the rows needing attention.

**History:** `GET /api/ghl/contacts/upload` lists recent batches;
`?batch_id=<id>` returns that batch's rows; add `&status=failed` for the retry set.
Persisted in `ghl_upload_batches` + `ghl_upload_rows` (migration `004`).

```bash
curl -X POST https://<domain>/api/ghl/contacts/upload \
  -H "Authorization: Bearer $FSOS_API_SECRET" \
  -F file=@docs/samples/contacts-template.csv \
  -F tags="apex-import,warm-lead" -F source="apex_import" \
  -F pipeline="prospect_client" -F stage=1
```

A ready-to-edit template lives at `docs/samples/contacts-template.csv`.
