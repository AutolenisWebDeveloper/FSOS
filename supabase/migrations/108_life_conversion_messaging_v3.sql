-- ─────────────────────────────────────────────────────────
-- Migration: 108_life_conversion_messaging_v3
--
-- Corrects WHO the Life Conversion copy says is writing (ADR-029 life-conversion-campaign,
-- ADR-016). Migrations 082 (seed) and 101 (v2 copy) are applied and are NOT modified — this
-- migration UPDATEs the same comm_templates rows IN PLACE (bump `version`, reset approval on
-- any body change). Template IDs are preserved, so life_campaign_touches keeps resolving the
-- same rows and the 20-touch / 180-day schedule and automation are untouched.
--
-- Every row lands at version 3 / approval_status='draft' with prior approval cleared. Nothing
-- here approves or activates anything.
--
-- ── WHAT WAS WRONG ──────────────────────────────────────────────────────────
-- Email #1 opened "It's {{fsa_name}} with {{agency_name}}. I work alongside your Farmers agent
-- on the life insurance side", which presents Markist Athelus Farmers Agency to the recipient
-- as though it were the agency their own Farmers agent belongs to. Every SMS and conversation
-- opener repeated a version of the same introduction, and the platform identity disclosure
-- (ADR-016) then prepended a second introduction of its own.
--
-- ── WHAT THIS CHANGES ───────────────────────────────────────────────────────
-- • The recipient's own agent is named by {{agent_of_record_reference}}, resolved per recipient
--   from the spine (households.referring_agency_id → agency_owners via buildRecipientContext):
--   "your Farmers agent, Jane Smith" when the name is on file, the approved generic "your
--   Farmers agent" when it is not. No agent name is ever guessed (§4.3).
-- • The FSA is identified as {{fsa_name}}, {{advisor_title}}, working WITH that agent.
-- • {{agency_name}} no longer appears in any customer-facing body.
-- • The introduction appears ONCE per channel — Email #1, SMS #1 and Conversation #1 — flagged
--   introduces_sender = true (migration 105) so the platform records the introduction and
--   stamps the thread instead of prepending a duplicate. Later touches never re-introduce.
--
-- ── THE CENTRAL COMPLIANCE CONSTRAINT FOR THIS CAMPAIGN (unchanged) ─────────
-- This audience owns an in-force life policy, so the tempting hook — "your policy has a
-- conversion option, and the window is closing" — is exactly what §4.3 and ADR-020 forbid:
-- term-conversion windows, product availability, and carrier rules are NOT publicly documented,
-- and FSOS holds no verified per-policy conversion data for these recipients. NO message here
-- asserts that the recipient's policy has a conversion option, states or implies a deadline,
-- names a product to convert into, or suggests replacing, exchanging, or modifying existing
-- coverage. Time-limited features are described ONLY as a general category worth checking, with
-- the review itself as the thing that establishes the facts.
--
-- COPY CONTRACT unchanged from v2 (Subject:/Preview: header lines, "* " bullets, exactly ONE
-- "Label {{scheduling_link}}" CTA, exactly ONE closer; no opt-out text in SMS because
-- dispatcher.ts appends SMS_OPT_OUT_FOOTER; only proven-resolvable merge tokens).
--
-- Verified by tests/lifecycle-campaign-messaging.test.mjs.
-- Idempotent; transaction-safe; no explicit BEGIN/COMMIT.
-- ─────────────────────────────────────────────────────────

-- ── Emails (7) — touches 1, 4, 8, 11, 14, 17, 20 ───────────────────────────
update comm_templates set
  name = 'Life Conversion — Email #1 — Know What You Already Own',
  body = $body$Subject: Do you know what your life insurance actually does?
Preview: Most people could not say. That is worth twenty minutes.

Hi {{first_name}},

I am {{fsa_name}}, the {{advisor_title}} working with {{agent_of_record_reference}}. I handle the life insurance and financial services side for the agency's clients, so I am a different name from the person you deal with about your other policies.

Here is an uncomfortable question most people cannot answer: what does your life insurance actually do, and for how long?

That is not a criticism. Life insurance is designed to be bought once and then forgotten, which is exactly what makes it easy to own for years without knowing its terms.

I would like to offer you a complimentary policy review. It is one conversation in which we look at what you already have, what it covers, how long it runs, and whether it still matches the life you are living now.

I want to be clear about what this is not. It is not a pitch to change anything. Most reviews end with the client knowing more and doing nothing, which is a perfectly good result.

Schedule Your Policy Review {{scheduling_link}}

If you would rather just ask a question first, reply to this email and I will answer it.

Sincerely, {{fsa_name}}

This email is provided for educational purposes and to invite you to review your existing coverage. Any recommendation would be based on your individual needs, objectives, and policy provisions after a personal consultation.$body$,
  introduces_sender = true,
  approval_status = 'draft', version = 3, approved_at = null, approved_by = null,
  updated_by = 'messaging-v3-identity', updated_at = now()
where id = 'e1c00000-0000-4000-8000-000000000001';

update comm_templates set
  name = 'Life Conversion — Email #2 — Policies Have Terms People Forget',
  body = $body$Subject: The parts of a policy people forget
Preview: Not secrets. Just details that fade once the paperwork is filed.

Hi {{first_name}},

Life insurance policies are not all the same, and the differences tend to live in details that fade from memory within about a year of signing.

Depending on the policy, those details can include:

* How long the coverage is scheduled to last
* Whether the cost stays level or changes over time
* What happens at the end of the term
* Whether the policy includes any options that are only available for a limited period
* Who the beneficiaries are, and whether that list is still current

I am not going to tell you which of these apply to your policy, because I would only be guessing. That is precisely the point of a review: we look at your actual contract rather than assume.

The beneficiary line is the one I would flag hardest. It is the most common thing to be out of date and the easiest to put right.

Review What You Have {{scheduling_link}}

Warm regards, {{fsa_name}}

Availability of policy features depends on your specific contract. Any discussion of options available to you will be individualized and based on your existing policy.$body$,
  introduces_sender = false,
  approval_status = 'draft', version = 3, approved_at = null, approved_by = null,
  updated_by = 'messaging-v3-identity', updated_at = now()
where id = 'e1c00000-0000-4000-8000-000000000002';

update comm_templates set
  name = 'Life Conversion — Email #3 — Does It Still Fit Your Life',
  body = $body$Subject: You bought that policy for a reason. Still the same reason?
Preview: The policy has not changed. Your life probably has.

Hi {{first_name}},

When you took out your life insurance, you had a particular situation in mind. A salary, a mortgage, maybe a person or two who depended on you.

The policy has not changed since. Your life probably has.

Any of these would be a reasonable prompt to look again:

* You got married, or that changed
* Children arrived, or grew up and became independent
* You bought a home, moved, or refinanced
* Your income changed meaningfully in either direction
* You paid off a mortgage or other significant debt
* You started thinking about retirement in concrete terms

A review does not mean changing anything. It means checking that a decision you made some years ago still does what you wanted it to do.

If one of those lines describes you, reply and tell me which. That is usually enough for me to say whether a conversation is worth your time.

Tell Me What Changed {{scheduling_link}}

Thank you, {{fsa_name}}

Any recommendation would be based on your personal circumstances, financial objectives, and the provisions of your existing policy.$body$,
  introduces_sender = false,
  approval_status = 'draft', version = 3, approved_at = null, approved_by = null,
  updated_by = 'messaging-v3-identity', updated_at = now()
where id = 'e1c00000-0000-4000-8000-000000000003';

update comm_templates set
  name = 'Life Conversion — Email #4 — What People Ask Before Booking',
  body = $body$Subject: The four questions people ask before booking this
Preview: Reasonable questions, answered plainly.

Hi {{first_name}},

People are understandably wary of a review offered by someone who also sells insurance. Here are the four questions I get asked most, answered plainly.

Will you try to sell me something? No. I will tell you what your policy does. If a gap turns up we will talk about it, and if it does not, we will not.

Do I have to change anything? No. A good number of these reviews end with me confirming everything is in order and suggesting nothing at all.

How long does it take? Around twenty to thirty minutes.

Why bother if nothing has changed? Because "nothing has changed" is usually an assumption rather than a fact, and beneficiary details in particular go stale quietly.

If any of that resonates, the calendar is open. If you would rather ask a fifth question first, just reply.

Book a Policy Review {{scheduling_link}}

Sincerely, {{fsa_name}}

Insurance products and policy features vary. Any discussion of options available to you will depend on your specific policy and individual circumstances.$body$,
  introduces_sender = false,
  approval_status = 'draft', version = 3, approved_at = null, approved_by = null,
  updated_by = 'messaging-v3-identity', updated_at = now()
where id = 'e1c00000-0000-4000-8000-000000000004';

update comm_templates set
  name = 'Life Conversion — Email #5 — What a Review Is and Is Not',
  body = $body$Subject: What this review is, and what it is not
Preview: Being specific, because the offer only means something if it is.

Hi {{first_name}},

I would rather be specific about this than have you guess.

What a policy review is:

* A look at what your current coverage actually provides
* A check that the beneficiary details are still correct
* A conversation about whether it still matches your circumstances
* An opportunity to ask anything you have wondered about

What it is not:

* A sales appointment with a review attached
* A prelude to being told your existing policy is inadequate
* Something that obliges you to change, add, or replace anything

That third point matters most. Replacing existing coverage is a serious step with real consequences, and it is not something I would raise lightly or automatically. If it never comes up, that is the likeliest outcome and a good one.

Reserve Your Policy Review {{scheduling_link}}

If you would prefer to speak directly, my number is below.

Warm regards, {{fsa_name}}

This communication is intended to encourage a review of your existing coverage and is not a recommendation to purchase, replace, or modify any insurance product.$body$,
  introduces_sender = false,
  approval_status = 'draft', version = 3, approved_at = null, approved_by = null,
  updated_by = 'messaging-v3-identity', updated_at = now()
where id = 'e1c00000-0000-4000-8000-000000000005';

update comm_templates set
  name = 'Life Conversion — Email #6 — Still Glad to Help',
  body = $body$Subject: Still glad to help whenever suits you
Preview: No urgency being manufactured here.

Hi {{first_name}},

I have written a few times about reviewing your life insurance, and you have not needed to take me up on it. That is completely fine.

I am not going to invent a deadline to make this feel urgent. There isn't one that I can point to honestly, and I would rather keep your trust than borrow against it.

What I will say is that this is the kind of thing that stays undone indefinitely without a nudge, and the nudge costs you twenty minutes.

If it helps, you can also start smaller. Reply with one question about your coverage and I will answer it in writing, with no meeting and no follow-up call. Several people have taken exactly that option.

Ask One Question Instead {{scheduling_link}}

Sincerely, {{fsa_name}}

Insurance needs change over time. Any recommendation discussed during your review would be based on your individual circumstances, financial objectives, and the provisions of your existing policy.$body$,
  introduces_sender = false,
  approval_status = 'draft', version = 3, approved_at = null, approved_by = null,
  updated_by = 'messaging-v3-identity', updated_at = now()
where id = 'e1c00000-0000-4000-8000-000000000006';

update comm_templates set
  name = 'Life Conversion — Email #7 — Final Invitation',
  body = $body$Subject: Closing this out, with one standing offer
Preview: The last email in this series.

Hi {{first_name}},

This is the last email in this series, so let me leave you with something useful rather than another request.

Whether or not we ever speak, do these two things at some point this year:

* Check who is named as the beneficiary on your policy, and confirm it is still who you would choose today
* Find out what date your coverage is scheduled to run to

You can do both without me, and both are worth knowing. If what you find raises a question, my details are below and they do not expire.

If you would still like a review, the calendar stays open indefinitely. If not, thank you for reading, and I am glad you have coverage in place at all. Plenty of people do not.

Schedule Whenever You Like {{scheduling_link}}

Warm regards, {{fsa_name}}

This email concludes this review invitation. Future communications will follow your recorded communication preferences and any applicable consent. You may unsubscribe from marketing email using the link below.$body$,
  introduces_sender = false,
  approval_status = 'draft', version = 3, approved_at = null, approved_by = null,
  updated_by = 'messaging-v3-identity', updated_at = now()
where id = 'e1c00000-0000-4000-8000-000000000007';

-- ── SMS (6) — touches 2, 5, 9, 12, 16, 19 ──────────────────────────────────
--    No opt-out text: dispatcher.ts appends SMS_OPT_OUT_FOOTER.
--    SMS #1 carries the introduction for this channel; the rest continue it.
--    No message asserts the recipient's policy has any particular feature.
update comm_templates set
  name = 'Life Conversion — SMS #1 — Introduction and Know What You Own',
  body = $body$Hi {{first_name}}, this is {{fsa_name}}, the {{advisor_title}} working with {{agent_of_record_reference}}. Could you say offhand what your life policy covers and how long it runs? A free 20-minute review answers exactly that.$body$,
  introduces_sender = true,
  approval_status = 'draft', version = 3, approved_at = null, approved_by = null,
  updated_by = 'messaging-v3-identity', updated_at = now()
where id = 'd1c00000-0000-4000-8000-000000000001';

update comm_templates set
  name = 'Life Conversion — SMS #2 — Check Your Beneficiary',
  body = $body$Hi {{first_name}}, one thing worth doing even without me: check who is named as beneficiary on your life policy. It is the most common detail to be out of date. Happy to help if anything looks off.$body$,
  introduces_sender = false,
  approval_status = 'draft', version = 3, approved_at = null, approved_by = null,
  updated_by = 'messaging-v3-identity', updated_at = now()
where id = 'd1c00000-0000-4000-8000-000000000002';

update comm_templates set
  name = 'Life Conversion — SMS #3 — Still the Same Reason',
  body = $body$Hi {{first_name}}, you bought your policy for a particular reason. Is it still the same reason? Marriage, kids, a move, or a change in income are all good prompts to look again. Reply and tell me which applies.$body$,
  introduces_sender = false,
  approval_status = 'draft', version = 3, approved_at = null, approved_by = null,
  updated_by = 'messaging-v3-identity', updated_at = now()
where id = 'd1c00000-0000-4000-8000-000000000003';

update comm_templates set
  name = 'Life Conversion — SMS #4 — Ask Me Anything',
  body = $body$Hi {{first_name}}, is there anything about your life insurance you have wondered about but never asked? Reply with it and I'll answer in writing. No meeting, no follow-up call.$body$,
  introduces_sender = false,
  approval_status = 'draft', version = 3, approved_at = null, approved_by = null,
  updated_by = 'messaging-v3-identity', updated_at = now()
where id = 'd1c00000-0000-4000-8000-000000000004';

update comm_templates set
  name = 'Life Conversion — SMS #5 — No Change Required',
  body = $body$Hi {{first_name}}, worth saying plainly: a policy review doesn't oblige you to change anything, and most end with no change at all. If a free 20-minute look would be useful: {{scheduling_link}}$body$,
  introduces_sender = false,
  approval_status = 'draft', version = 3, approved_at = null, approved_by = null,
  updated_by = 'messaging-v3-identity', updated_at = now()
where id = 'd1c00000-0000-4000-8000-000000000005';

update comm_templates set
  name = 'Life Conversion — SMS #6 — Final Note',
  body = $body$Hi {{first_name}}, last message in this series. Two things worth checking yourself: who your beneficiary is, and what date your cover runs to. If either raises a question, reply any time. All the best.$body$,
  introduces_sender = false,
  approval_status = 'draft', version = 3, approved_at = null, approved_by = null,
  updated_by = 'messaging-v3-identity', updated_at = now()
where id = 'd1c00000-0000-4000-8000-000000000006';

-- ── AI conversation openers (5) — touches 3, 6, 10, 15, 18 ─────────────────
--    Every opener self-identifies as an automated assistant (§4.2 / TRAIGA).
--    Conversation #1 introduces the assistant AND whose assistant it is; #2-#5 continue.
--    Bodies mirror PLAYBOOKS[].opening in src/lib/life-campaign/playbooks.ts.
update comm_templates set
  name = 'Life Conversion — Conversation #1 — Initial Check-In',
  body = $body$Hi {{first_name}}, I'm the automated assistant for {{fsa_name}}, the {{advisor_title}} working with {{agent_of_record_reference}}. Policyholders are offered a free 20-minute policy review. Book one, ask a question, or not now?$body$,
  introduces_sender = true,
  approval_status = 'draft', version = 3, approved_at = null, approved_by = null,
  updated_by = 'messaging-v3-identity', updated_at = now()
where id = 'c1c00000-0000-4000-8000-000000000001';

update comm_templates set
  name = 'Life Conversion — Conversation #2 — Life Changes',
  body = $body$Hi {{first_name}}, {{fsa_name}}'s automated assistant here. Has anything changed since you took out your life policy, such as marriage, children, a move, or a change in income?$body$,
  introduces_sender = false,
  approval_status = 'draft', version = 3, approved_at = null, approved_by = null,
  updated_by = 'messaging-v3-identity', updated_at = now()
where id = 'c1c00000-0000-4000-8000-000000000002';

update comm_templates set
  name = 'Life Conversion — Conversation #3 — Open Questions',
  body = $body$Hi {{first_name}}, this is {{fsa_name}}'s automated assistant. Is there anything about your current life cover you have wondered about, such as how long it runs or who it pays out to?$body$,
  introduces_sender = false,
  approval_status = 'draft', version = 3, approved_at = null, approved_by = null,
  updated_by = 'messaging-v3-identity', updated_at = now()
where id = 'c1c00000-0000-4000-8000-000000000003';

update comm_templates set
  name = 'Life Conversion — Conversation #4 — Beneficiary Check',
  body = $body$Hi {{first_name}}, {{fsa_name}}'s automated assistant here. A quick one worth checking: is the beneficiary named on your policy still the person you would choose today? It is the most common detail to go out of date.$body$,
  introduces_sender = false,
  approval_status = 'draft', version = 3, approved_at = null, approved_by = null,
  updated_by = 'messaging-v3-identity', updated_at = now()
where id = 'c1c00000-0000-4000-8000-000000000004';

update comm_templates set
  name = 'Life Conversion — Conversation #5 — Final Invitation',
  body = $body$Hi {{first_name}}, {{fsa_name}}'s automated assistant one last time. Would you like to book your free policy review, have us check back later, or close this out for now? Any of the three is fine.$body$,
  introduces_sender = false,
  approval_status = 'draft', version = 3, approved_at = null, approved_by = null,
  updated_by = 'messaging-v3-identity', updated_at = now()
where id = 'c1c00000-0000-4000-8000-000000000005';

-- ── ROLLBACK (manual) ───────────────────────────────────────────────────────
--   Re-apply 101_life_conversion_messaging_v2.sql, then set introduces_sender = false for
--   the template IDs above (all remain approval_status='draft' either way).
