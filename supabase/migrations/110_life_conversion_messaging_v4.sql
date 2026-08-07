-- ─────────────────────────────────────────────────────────
-- Migration: 110_life_conversion_messaging_v4
--
-- Centers every Life Conversion touch on the ACTUAL conversion opportunity (owner-directed
-- 2026-08-07): the recipient's Farmers term policy carries a conversion privilege — eligible
-- term coverage may become permanent life insurance — and that privilege expires on a verified
-- date. The seven emails now progress awareness → education → term-vs-permanent → partial
-- conversion → deadline → decision → final notice; SMS and AI openers carry the same arc.
--
-- Migrations 082 (seed), 101 (v2) and 108 (v3) are applied and NOT modified — this migration
-- UPDATEs the same comm_templates rows IN PLACE (version 4, approval reset). Template IDs are
-- preserved, so life_campaign_touches keeps resolving the same rows; the 20-touch / 180-day
-- schedule and automation are untouched. Nothing here approves or activates anything.
--
-- ── WHY THE v3 CONSTRAINT NO LONGER BARS CONVERSION COPY ────────────────────
-- 108's copy avoided every conversion claim because "FSOS holds no verified per-policy
-- conversion data". For THIS campaign's population that premise is no longer true:
--   • Enrollment is drawn exclusively from v_conversions_due — policies with a VERIFIED
--     conversion_deadline, imported from the FNWL conversion list (import/conversionList.ts),
--     which also supplies the policy_number and writes the verified convertible amount as
--     face_amount. The enrollment row snapshots the verified deadline.
--   • Every fact in this copy resolves per recipient through BLOCKING-tier merge variables
--     ({{policy_number}}, {{policy_face_amount}}, {{conversion_expiration_date}},
--     {{days_until_conversion_expires}}): the tick passes enrollment.policy_id into
--     sendThroughGate, resolvePolicySource() loads the policy row, and a recipient whose record
--     lacks ANY referenced fact is HARD-BLOCKED at gate step `personalization` and escalated —
--     never sent a guess or a blank (§4.3 / ADR-020).
--   • The "no new medical exam" statement is additionally gated by the VERIFIED per-policy flag
--     household_policies.conversion_no_exam (migration 109): {{conversion_exam_clause}} renders
--     "with no new medical exam" ONLY when that flag is true, and otherwise degrades to the
--     always-true neutral "subject to the conversion provisions in your policy". The claim is
--     never made from an assumption.
--
-- ── WHAT REMAINS FORBIDDEN (unchanged, §4.2) ────────────────────────────────
-- No individualized recommendation to convert, no product named to convert into, no premium
-- quoted, no suitability statement, no replacement language. The copy states verified facts,
-- educates on what the privilege is in general terms, and invites a complimentary review
-- (free permanent-coverage quotes + current-policy review) with the licensed FSA, where the
-- individualized conversation belongs. Every AI conversation still escalates individualized
-- questions to the FSA.
--
-- COPY CONTRACT unchanged (Subject:/Preview: header lines, exactly ONE
-- "Label {{scheduling_link}}" CTA block, exactly ONE closer; no opt-out text in SMS because
-- dispatcher.ts appends SMS_OPT_OUT_FOOTER; only proven-resolvable merge tokens; GSM-7-safe
-- SMS/AI bodies <= 235 authored chars; introduce-once flags preserved on Email 1 / SMS 1 / AI 1).
--
-- Verified by tests/lifecycle-campaign-messaging.test.mjs (v4 section) and
-- tests/comms-email-subject.test.mjs. Idempotent; transaction-safe; no explicit BEGIN/COMMIT.
-- ─────────────────────────────────────────────────────────

-- ── Emails (7) — touches 1, 4, 8, 11, 14, 17, 20 ───────────────────────────
update comm_templates set
  name = 'Life Conversion — Email #1 — Conversion Opportunity',
  body = $body$Subject: The conversion option on your Farmers term life policy
Preview: A time-limited privilege included with your coverage, worth understanding.

Hi {{first_name}},

I am {{fsa_name}}, the {{advisor_title}} working with {{agent_of_record_reference}}. I handle the life insurance and financial services side for the agency's clients.

I am reaching out about the conversion option available on your Farmers term life insurance policy.

Policy number: {{policy_number}}
Coverage: {{policy_face_amount}}
Conversion deadline: {{conversion_expiration_date}}

You may be able to convert eligible term coverage to permanent life insurance {{conversion_exam_clause}}.

Because this option expires, I would like to review your conversion choices with you before {{conversion_expiration_date}}. The review is complimentary and there is no obligation to make any change.

Schedule Your Conversion Review {{scheduling_link}}

If you would rather ask a question first, reply to this email and I will answer it.

Best regards, {{fsa_name}}

Provided for educational purposes and to invite a review of your existing coverage. Whether conversion is available for your coverage is determined by your policy's own provisions, and any recommendation would follow a personal consultation with a licensed professional.$body$,
  introduces_sender = true,
  approval_status = 'draft', version = 4, approved_at = null, approved_by = null,
  updated_by = 'messaging-v4-conversion', updated_at = now()
where id = 'e1c00000-0000-4000-8000-000000000001';

update comm_templates set
  name = 'Life Conversion — Email #2 — Why Conversion Matters',
  body = $body$Subject: An important option included with your term policy
Preview: Worth reviewing before the conversion window closes.

Hi {{first_name}},

Your Farmers term policy includes an option worth understanding before it expires.

Policy number: {{policy_number}}
Conversion deadline: {{conversion_expiration_date}}

Eligible term coverage may be converted to permanent life insurance {{conversion_exam_clause}}.

That can matter a great deal if your health or your insurance needs have changed since you originally purchased the policy, because conversion works from the coverage you already have in place.

I can walk you through the conversion choices available under your policy and answer your questions. The review is complimentary, and quotes for permanent coverage are free and carry no obligation.

Schedule Your Conversion Review {{scheduling_link}}

Warm regards, {{fsa_name}}

Availability of conversion depends on your specific contract. Any discussion of options will be individualized, based on your existing policy, and led by a licensed professional.$body$,
  introduces_sender = false,
  approval_status = 'draft', version = 4, approved_at = null, approved_by = null,
  updated_by = 'messaging-v4-conversion', updated_at = now()
where id = 'e1c00000-0000-4000-8000-000000000002';

update comm_templates set
  name = 'Life Conversion — Email #3 — Term vs. Permanent',
  body = $body$Subject: Your term coverage does not have to end with your term
Preview: What conversion means, in plain language.

Hi {{first_name}},

Term insurance provides coverage for a set period. Permanent life insurance is designed to continue beyond a set term, for as long as the policy stays in force.

Conversion is the bridge between the two: your existing policy may allow eligible term coverage to be converted to permanent coverage {{conversion_exam_clause}}.

Policy number: {{policy_number}}
Coverage: {{policy_face_amount}}
Conversion deadline: {{conversion_expiration_date}}

A review covers what conversion would look like for your policy, what your choices are, and what happens if you simply let the term run its course. Knowing all three puts the decision in your hands.

Schedule Your Conversion Review {{scheduling_link}}

Thank you, {{fsa_name}}

This email explains a general policy feature. Whether and how conversion applies to your coverage is determined by your policy's provisions and reviewed with a licensed professional.$body$,
  introduces_sender = false,
  approval_status = 'draft', version = 4, approved_at = null, approved_by = null,
  updated_by = 'messaging-v4-conversion', updated_at = now()
where id = 'e1c00000-0000-4000-8000-000000000003';

update comm_templates set
  name = 'Life Conversion — Email #4 — Partial Conversion',
  body = $body$Subject: You may not need to convert your entire policy
Preview: Converting a portion of your coverage is often an option.

Hi {{first_name}},

Converting your term policy does not have to mean converting all of it.

Depending on your policy and the options available, you may be able to convert only a portion of your eligible coverage to permanent life insurance and keep the rest as term.

Policy number: {{policy_number}}
Current coverage: {{policy_face_amount}}
Conversion deadline: {{conversion_expiration_date}}

That flexibility is useful when balancing long-term coverage goals against premium considerations, and it is exactly the kind of thing a review works through. An eligible conversion is handled {{conversion_exam_clause}}.

Schedule Your Conversion Review {{scheduling_link}}

Sincerely, {{fsa_name}}

Partial-conversion availability varies by policy and product. Any discussion of what is available to you will be individualized, based on your existing policy, and led by a licensed professional.$body$,
  introduces_sender = false,
  approval_status = 'draft', version = 4, approved_at = null, approved_by = null,
  updated_by = 'messaging-v4-conversion', updated_at = now()
where id = 'e1c00000-0000-4000-8000-000000000004';

update comm_templates set
  name = 'Life Conversion — Email #5 — Deadline Approaching',
  body = $body$Subject: Your conversion deadline is approaching
Preview: The conversion option on your term policy is time-limited.

Hi {{first_name}},

A reminder that the conversion period on your Farmers term policy has an expiration date.

Policy number: {{policy_number}}
Conversion deadline: {{conversion_expiration_date}}
Days remaining: {{days_until_conversion_expires}}

Before that date, eligible coverage may be converted to permanent life insurance {{conversion_exam_clause}}. After it, that option is no longer part of your policy.

You are under no obligation to convert anything. I simply do not want the window to close before you have had the chance to review what it offers.

Schedule Your Conversion Review {{scheduling_link}}

Best regards, {{fsa_name}}

Provided as a factual reminder of a time-limited policy feature. Any recommendation would be based on your individual circumstances and the provisions of your existing policy, after a personal consultation.$body$,
  introduces_sender = false,
  approval_status = 'draft', version = 4, approved_at = null, approved_by = null,
  updated_by = 'messaging-v4-conversion', updated_at = now()
where id = 'e1c00000-0000-4000-8000-000000000005';

update comm_templates set
  name = 'Life Conversion — Email #6 — Decision Time',
  body = $body$Subject: Before your term conversion option expires
Preview: All, some, or none: a short review makes the choice concrete.

Hi {{first_name}},

Your term life conversion deadline is getting closer.

Policy number: {{policy_number}}
Coverage: {{policy_face_amount}}
Conversion deadline: {{conversion_expiration_date}}

If you have been considering keeping some life insurance protection in place beyond your term, this is the time to review the conversion option while it is still available.

A short review walks through what converting all, some, or none of your eligible coverage would look like, with free quotes for the permanent options and a review of your current policy included. An eligible conversion is completed {{conversion_exam_clause}}.

Schedule Your Conversion Review {{scheduling_link}}

Warm regards, {{fsa_name}}

A review obliges you to change nothing. Any recommendation would be individualized, based on your existing policy and personal circumstances, and made by a licensed professional.$body$,
  introduces_sender = false,
  approval_status = 'draft', version = 4, approved_at = null, approved_by = null,
  updated_by = 'messaging-v4-conversion', updated_at = now()
where id = 'e1c00000-0000-4000-8000-000000000006';

update comm_templates set
  name = 'Life Conversion — Email #7 — Final Conversion Notice',
  body = $body$Subject: Final reminder about your conversion option
Preview: The last email in this series about your conversion window.

Hi {{first_name}},

This is my final reminder about the conversion option on your Farmers term life insurance policy.

Policy number: {{policy_number}}
Coverage: {{policy_face_amount}}
Conversion deadline: {{conversion_expiration_date}}

Eligible coverage may be converted to permanent life insurance {{conversion_exam_clause}}, and that option ends on the date above.

If you would like to review your choices before then, my calendar is open. If you have already decided conversion is not for you, no response is needed; your term coverage simply continues as it is for the remainder of its term.

Review Your Conversion Options {{scheduling_link}}

Sincerely, {{fsa_name}}

This concludes this reminder series. Future communications will follow your recorded communication preferences and any applicable consent. You may unsubscribe from marketing email using the link below.$body$,
  introduces_sender = false,
  approval_status = 'draft', version = 4, approved_at = null, approved_by = null,
  updated_by = 'messaging-v4-conversion', updated_at = now()
where id = 'e1c00000-0000-4000-8000-000000000007';

-- ── SMS (6) — touches 2, 5, 9, 12, 16, 19 ──────────────────────────────────
--    No opt-out text: dispatcher.ts appends SMS_OPT_OUT_FOOTER.
--    SMS #1 carries the introduction for this channel; the rest continue it.
--    Every deadline stated is the recipient's own VERIFIED date (blocking token).
--    The no-exam claim is intentionally absent from SMS: it belongs to email/review,
--    where the {{conversion_exam_clause}} gate can phrase it correctly.
update comm_templates set
  name = 'Life Conversion — SMS #1 — Introduction and Conversion Window',
  body = $body$Hi {{first_name}}, this is {{fsa_name}}, the {{advisor_title}} working with {{agent_of_record_reference}}. The conversion option on your Farmers term life policy expires {{conversion_expiration_date}}. A free review walks through it.$body$,
  introduces_sender = true,
  approval_status = 'draft', version = 4, approved_at = null, approved_by = null,
  updated_by = 'messaging-v4-conversion', updated_at = now()
where id = 'd1c00000-0000-4000-8000-000000000001';

update comm_templates set
  name = 'Life Conversion — SMS #2 — What Conversion Means',
  body = $body$Hi {{first_name}}, a fact worth knowing: eligible coverage on your term life policy may be converted to permanent life insurance before {{conversion_expiration_date}}. Reply with any question and I will answer it.$body$,
  introduces_sender = false,
  approval_status = 'draft', version = 4, approved_at = null, approved_by = null,
  updated_by = 'messaging-v4-conversion', updated_at = now()
where id = 'd1c00000-0000-4000-8000-000000000002';

update comm_templates set
  name = 'Life Conversion — SMS #3 — Partial Conversion',
  body = $body$Hi {{first_name}}, converting your term policy is not all or nothing. Depending on your policy options, a portion of eligible coverage may be converted. Your window closes {{conversion_expiration_date}}.$body$,
  introduces_sender = false,
  approval_status = 'draft', version = 4, approved_at = null, approved_by = null,
  updated_by = 'messaging-v4-conversion', updated_at = now()
where id = 'd1c00000-0000-4000-8000-000000000003';

update comm_templates set
  name = 'Life Conversion — SMS #4 — Ask Me Anything',
  body = $body$Hi {{first_name}}, is there anything about the conversion option on your term policy you have wondered about? Reply with it and I will answer in writing. No meeting, no follow-up call.$body$,
  introduces_sender = false,
  approval_status = 'draft', version = 4, approved_at = null, approved_by = null,
  updated_by = 'messaging-v4-conversion', updated_at = now()
where id = 'd1c00000-0000-4000-8000-000000000004';

update comm_templates set
  name = 'Life Conversion — SMS #5 — Deadline and Booking',
  body = $body$Hi {{first_name}}, your term conversion window closes {{conversion_expiration_date}}. A free 20-minute review covers your choices, with no obligation to change anything: {{scheduling_link}}$body$,
  introduces_sender = false,
  approval_status = 'draft', version = 4, approved_at = null, approved_by = null,
  updated_by = 'messaging-v4-conversion', updated_at = now()
where id = 'd1c00000-0000-4000-8000-000000000005';

update comm_templates set
  name = 'Life Conversion — SMS #6 — Final Note',
  body = $body$Hi {{first_name}}, last text in this series. Your conversion option ends {{conversion_expiration_date}}. Reply or book any time before then: {{scheduling_link}}. Either way, your term coverage continues as is.$body$,
  introduces_sender = false,
  approval_status = 'draft', version = 4, approved_at = null, approved_by = null,
  updated_by = 'messaging-v4-conversion', updated_at = now()
where id = 'd1c00000-0000-4000-8000-000000000006';

-- ── AI conversation openers (5) — touches 3, 6, 10, 15, 18 ─────────────────
--    Every opener self-identifies as an automated assistant (§4.2 / TRAIGA).
--    Conversation #1 introduces the assistant AND whose assistant it is; #2-#5 continue.
--    Bodies mirror PLAYBOOKS[].opening in src/lib/life-campaign/playbooks.ts.
--    Fact tokens are safe HERE because the tick supplies policy context; the playbook
--    followUp/handoff/closing fields stay fact-token-free (no policy context on that path).
update comm_templates set
  name = 'Life Conversion — Conversation #1 — Initial Conversion Check-In',
  body = $body$Hi {{first_name}}, I'm the automated assistant for {{fsa_name}}, the {{advisor_title}} working with {{agent_of_record_reference}}. Your term conversion option expires {{conversion_expiration_date}}. Free review, question, or not now?$body$,
  introduces_sender = true,
  approval_status = 'draft', version = 4, approved_at = null, approved_by = null,
  updated_by = 'messaging-v4-conversion', updated_at = now()
where id = 'c1c00000-0000-4000-8000-000000000001';

update comm_templates set
  name = 'Life Conversion — Conversation #2 — How Conversion Works',
  body = $body$Hi {{first_name}}, {{fsa_name}}'s automated assistant here. Do you know how the conversion option on your term policy works? I can explain in general terms, or book you a free review before {{conversion_expiration_date}}.$body$,
  introduces_sender = false,
  approval_status = 'draft', version = 4, approved_at = null, approved_by = null,
  updated_by = 'messaging-v4-conversion', updated_at = now()
where id = 'c1c00000-0000-4000-8000-000000000002';

update comm_templates set
  name = 'Life Conversion — Conversation #3 — Partial Conversion',
  body = $body$Hi {{first_name}}, this is {{fsa_name}}'s automated assistant. Converting your term policy is not all or nothing - a portion of eligible coverage may qualify. Want a free review of your choices before {{conversion_expiration_date}}?$body$,
  introduces_sender = false,
  approval_status = 'draft', version = 4, approved_at = null, approved_by = null,
  updated_by = 'messaging-v4-conversion', updated_at = now()
where id = 'c1c00000-0000-4000-8000-000000000003';

update comm_templates set
  name = 'Life Conversion — Conversation #4 — Deadline Check',
  body = $body$Hi {{first_name}}, {{fsa_name}}'s automated assistant here. Your conversion window closes {{conversion_expiration_date}}, {{days_until_conversion_expires}} days from now. Book a free review, ask a question, or leave it for now?$body$,
  introduces_sender = false,
  approval_status = 'draft', version = 4, approved_at = null, approved_by = null,
  updated_by = 'messaging-v4-conversion', updated_at = now()
where id = 'c1c00000-0000-4000-8000-000000000004';

update comm_templates set
  name = 'Life Conversion — Conversation #5 — Final Invitation',
  body = $body$Hi {{first_name}}, {{fsa_name}}'s automated assistant one last time. Your conversion option ends {{conversion_expiration_date}}. Book a free review, have us check back, or close this out? Any of the three is fine.$body$,
  introduces_sender = false,
  approval_status = 'draft', version = 4, approved_at = null, approved_by = null,
  updated_by = 'messaging-v4-conversion', updated_at = now()
where id = 'c1c00000-0000-4000-8000-000000000005';

-- ── ROLLBACK (manual) ───────────────────────────────────────────────────────
--   Re-apply 108_life_conversion_messaging_v3.sql (all rows return to the v3 review-generic
--   copy at version 3, draft; introduces_sender flags are identical in both versions).
