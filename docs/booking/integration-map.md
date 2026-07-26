# Native Booking — Integration Map (the "leave no dead ends" checklist)

_Every place an appointment is created, displayed, edited, or referenced today, and what native
booking must do at each. This is the completeness checklist for the initiative (§2.B): the initiative
is **not** done while any row's "Native-booking requirement" is unmet. Line refs are point-in-time._

## Appointment surfaces

| Surface | File | Today | Native-booking requirement |
|---|---|---|---|
| FSA calendar | `src/app/(fsa)/app/calendar/page.tsx` + `src/components/app/CalendarView.tsx` | Reads native `appointments` via `load()`; funnel tiles, overdue triage, no-show recovery, agenda | Already reads native rows → native bookings appear automatically. Verify new columns (type, mode, join link) surface; add booking config entry point (Slice 2). |
| Client appointments | `src/app/(client)/client/appointments/page.tsx` | Native `appointments` by `household_id` via allowlist (`id, scheduled_at, status`) | Widen allowlist to show type/mode/join link; native bookings appear via `scheduled_at` kept == `starts_at`. |
| Client schedule | `src/app/(client)/client/schedule/page.tsx` | **Static stub** — no submit | Wire to the booking flow (link/embed `/schedule`), Slice 3. |
| Client dashboard | `src/app/(client)/client/page.tsx` | Native `appointments` count (`status='scheduled'`) | Works once native bookings write scheduled rows. |
| Partner schedule | `src/app/(partner)/partner/schedule/page.tsx` | **Static stub** | Link to booking where appropriate (Slice 3), or leave as informational. |
| Main dashboard API | `src/app/api/dashboard/route.ts` | `counts.appointments` hardcoded `0`; `?scope=calendar` reads **legacy Model B** | Aggregate native appointments; retire the Model B calendar scope (Slice 8). |
| Reviews → new | `src/app/(fsa)/app/reviews/new` → `src/app/api/reviews/route.ts` | **Only native insert path** (review with `scheduled_at`) | Keep working; manual/native/review bookings must behave identically (populate `starts_at`, `booked_via`). |
| Meeting-prep | `src/app/api/customers/meeting-prep/route.ts` | AI one-pager; no appt table | No change. |
| Reviews calendar | `src/app/(fsa)/app/reviews/calendar/page.tsx` | Reads `reviews` (not `appointments`) | No change; appointments link to reviews via `review_id`. |
| Revenue center | `src/app/(fsa)/app/revenue/page.tsx` + `src/lib/revenue/center.ts` | Native `appointments` → funnel | Works; native bookings feed the funnel. |
| Comms claim-resolver | `src/lib/comms/claim-resolver.ts` `resolveAppointmentAt()` | Native `appointments` (`scheduled_at, status`) | Works; native bookings verify the `appointment_at` merge field. |
| Lifecycle | `src/lib/appointments/{recovery,service}.ts`, `/api/app/appointments/[id]`, `/recovery` | State machine + no-show recovery | Native bookings inherit lifecycle; cancel/reschedule (Slice 6) reuse these transitions. |
| Emails | `src/emails/appointments.tsx` + `registry.tsx` | 4 lifecycle templates registered | Reuse for confirmation/reminder/reschedule via comms (Slice 5/6). |

## Calendly footprint (Slice 8 removal)

`src/app/api/webhooks/calendly/route.ts` · `src/lib/site.ts` `bookingUrl()` · `src/lib/forms.ts` (called by webhook) ·
`src/app/api/health/route.ts` (`calendly_secret`) · `src/app/api/dashboard/route.ts` (Model B calendar scope) ·
`src/components/pages/fsos_command_center.jsx` (legacy). **Leave the GHL webhook's appointment handling alone** (frozen GHL initiative).

## Public entry points (Slice 3)

- `/schedule` + `/schedule/success` — already allowlisted (`src/lib/auth/rbac.ts`), no page files yet → the booking flow's home.
- `src/lib/site.ts` `bookingUrl()` → repoint to `/schedule` (drives `SiteHeader` "Schedule Appointment" + homepage "Schedule a Consultation" CTAs).
- Client/partner schedule stubs → link to the flow.

## Lifecycle chain to prove end-to-end (§2.B)

book → native `appointments` row (spine) → Zoom meeting if `video` → confirmation via comms → reminder via comms →
appears on every calendar/dashboard/portal → reschedule/cancel updates every surface + the Zoom meeting →
completed/no-show flows to reviews + activity + revenue funnel. No link may 404; removed Calendly links are replaced.
