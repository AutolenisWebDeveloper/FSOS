-- ─────────────────────────────────────────────────────────
-- Migration: 086_cross_sell_life_seed
--
-- Seeds the Cross-Sell Life Campaign: one xsell_life_campaigns row (status 'draft', version 1), its
-- 35 xsell_life_campaign_touches (spec §6), and the §7/§8/§9 message assets as DRAFT comm_templates
-- (12 emails, 12 SMS, 7 AI conversation openers).
--
-- "Verbatim copy" (spec §7/§8) means engineering does NOT rewrite the wording — it does NOT skip
-- approval. Every template lands as approval_status='draft' and must pass the existing human
-- approval gate before the campaign can dispatch it (ADR-023); sendThroughGate() refuses an
-- unapproved template regardless. Bodies are verbatim §7/§8/§9 copy; only merge-token SYNTAX is
-- mapped to repo-native snake_case tokens ({{FirstName}}→{{first_name}}, {{AdvisorName}}→{{fsa_name}},
-- {{AgencyName}}→{{agency_name}}, {{SchedulingLink}}→{{scheduling_link}}, {{AdvisorPhone}}→
-- {{advisor_phone}}, {{AdvisorEmail}}→{{advisor_email}}) so tokens resolve — the delivered message
-- is identical.
--
-- Fixed UUIDs make this fully idempotent (re-run = no-op via primary-key / natural-key conflict).
-- Transaction-safe; no explicit BEGIN/COMMIT.
-- ─────────────────────────────────────────────────────────

-- ── Emails (12) — channel 'email', category 'cross_sell_life' ───────────────
insert into comm_templates (id, name, channel, category, body, approval_status, version) values
('e5c00000-0000-4000-8000-000000000001', 'Cross-Sell Life — Email 1 — Thank You for Being Our Client', 'email', 'cross_sell_life',
$body$Subject: Thank You for Trusting Our Agency
Preview: We appreciate the opportunity to serve you.

Hi {{first_name}},

Thank you for trusting {{agency_name}} with your insurance and financial needs.

Because you are already part of our agency family, we periodically review whether there may be other areas where we can be helpful. One area many clients have not recently reviewed is life insurance.

A life insurance review is not a commitment to purchase anything. It is simply an opportunity to discuss your current situation, answer questions, and determine whether there may be a protection gap worth addressing.

If you would like to schedule a complimentary conversation, you may select a convenient time below.

Schedule a Complimentary Protection Review {{scheduling_link}}

You may also reply directly to this email with any questions.

Warm regards, {{fsa_name}} {{agency_name}} {{advisor_phone}} {{advisor_email}}

This communication is for general informational purposes. Any recommendation would be based on your individual needs and circumstances following a personal consultation. You may unsubscribe from marketing email using the link below.$body$, 'draft', 1),

('e5c00000-0000-4000-8000-000000000002', 'Cross-Sell Life — Email 2 — Have You Reviewed Your Life Coverage?', 'email', 'cross_sell_life',
$body$Subject: When Did You Last Review Your Life Insurance Needs?
Preview: Your protection needs may change as your life changes.

Hi {{first_name}},

Many people review their auto, home, and other insurance regularly but go years without reviewing their life insurance needs.

Your needs may change because of:

* Marriage
* Children
* Homeownership
* Changes in income
* New debt
* A new business
* Retirement planning
* Changes in existing coverage

Even when no major event has occurred, it may be helpful to understand where you currently stand.

We would be happy to provide a complimentary protection review with no obligation.

Review My Protection Needs {{scheduling_link}}

Warm regards, {{fsa_name}} {{agency_name}}

This email is educational and is not a recommendation regarding any specific policy, carrier, coverage amount, or premium.$body$, 'draft', 1),

('e5c00000-0000-4000-8000-000000000003', 'Cross-Sell Life — Email 3 — Life Changes', 'email', 'cross_sell_life',
$body$Subject: Has Anything Important Changed Recently?
Preview: Major life changes often affect protection needs.

Hi {{first_name}},

Life rarely stays the same for long.

Since you first became a client, you may have:

* Purchased or refinanced a home
* Gotten married
* Welcomed a child or grandchild
* Changed jobs
* Received a promotion
* Started a business
* Taken on new financial responsibilities
* Begun planning more seriously for retirement

Changes like these can affect how much financial protection a household may want to consider.

A short conversation can help you understand whether your current protection still reflects your life today.

Schedule a Complimentary Review {{scheduling_link}}

Sincerely, {{fsa_name}} {{agency_name}}

This message is provided for general educational purposes. Any personalized recommendation requires an individual review.$body$, 'draft', 1),

('e5c00000-0000-4000-8000-000000000004', 'Cross-Sell Life — Email 4 — Life Insurance Myths', 'email', 'cross_sell_life',
$body$Subject: Four Common Life Insurance Myths
Preview: Some common assumptions may prevent people from reviewing their options.

Hi {{first_name}},

Life insurance is often postponed because of a few common assumptions.

"I am too young to need it." Protection needs can exist at many ages, especially when someone has income, debt, dependents, or long-term obligations.

"It is always expensive." Cost varies based on coverage type, amount, age, health, underwriting, and other factors. There is no universal price.

"My workplace coverage is enough." Employer coverage may be limited and may not continue after a job change.

"I can always take care of it later." Future eligibility and pricing cannot be guaranteed.

These points are educational—not a recommendation to purchase coverage. A personal review is the appropriate way to determine whether anything should be considered.

Ask a Question or Schedule a Review {{scheduling_link}}

Warm regards, {{fsa_name}} {{agency_name}}

This email is for general informational purposes only.$body$, 'draft', 1),

('e5c00000-0000-4000-8000-000000000005', 'Cross-Sell Life — Email 5 — Protecting Income and Family', 'email', 'cross_sell_life',
$body$Subject: What Would Your Income Need to Continue Protecting?
Preview: Life insurance can help protect more than final expenses.

Hi {{first_name}},

Life insurance is often associated only with final expenses, but many households also use it to help address broader financial responsibilities.

Those responsibilities may include:

* Replacing income
* Paying a mortgage
* Reducing outstanding debt
* Supporting children
* Funding education goals
* Providing business continuity
* Protecting long-term family plans

The appropriate considerations are different for every household.

A complimentary review can help organize those responsibilities and determine whether further discussion is appropriate.

Schedule a Protection Review {{scheduling_link}}

Warm regards, {{fsa_name}} {{agency_name}}

This communication does not recommend a specific product or coverage amount. Any recommendation would require a personal needs analysis.$body$, 'draft', 1),

('e5c00000-0000-4000-8000-000000000006', 'Cross-Sell Life — Email 6 — Employer Coverage', 'email', 'cross_sell_life',
$body$Subject: Is Life Insurance Through Work Enough?
Preview: Employer coverage can be valuable, but it may have limitations.

Hi {{first_name}},

Life insurance provided through an employer can be an important benefit.

However, it may be helpful to understand:

* How much coverage the employer provides
* Whether the coverage is portable
* Whether it continues after a job change
* Whether the amount changes at retirement
* Whether supplemental coverage is individually owned
* Whether the benefit would address your household's actual obligations

Employer coverage and individually owned coverage serve different purposes.

We can help you review what you currently have and identify questions you may want to consider.

Review My Existing Coverage {{scheduling_link}}

Sincerely, {{fsa_name}} {{agency_name}}

This email is educational and is not a recommendation to replace, reduce, or purchase any particular coverage.$body$, 'draft', 1),

('e5c00000-0000-4000-8000-000000000007', 'Cross-Sell Life — Email 7 — Understanding Coverage Needs', 'email', 'cross_sell_life',
$body$Subject: How Do People Estimate Life Insurance Needs?
Preview: There is no universal number, but several factors are commonly considered.

Hi {{first_name}},

There is no single coverage amount that is right for everyone.

A personal protection review commonly considers:

* Income replacement
* Mortgage and housing obligations
* Consumer debt
* Final expenses
* Education goals
* Dependent care
* Existing savings and assets
* Existing life insurance
* Business obligations
* Long-term family goals

The purpose is not to select an arbitrary number. It is to understand what responsibilities would remain and what resources would be available.

We would be happy to walk through these considerations with you.

Talk Through My Protection Needs {{scheduling_link}}

Warm regards, {{fsa_name}} {{agency_name}}

This information is general and educational. Any specific coverage recommendation would require a review of your individual circumstances.$body$, 'draft', 1),

('e5c00000-0000-4000-8000-000000000008', 'Cross-Sell Life — Email 8 — Why People Wait', 'email', 'cross_sell_life',
$body$Subject: Why Life Insurance Reviews Often Get Postponed
Preview: A short conversation may be easier than continuing to put it off.

Hi {{first_name}},

Many people intend to review life insurance but continue postponing it.

Common reasons include:

* Life is busy
* The subject feels complicated
* They expect the process to take too long
* They are unsure what questions to ask
* They are concerned about cost
* There is no immediate deadline

You do not need to make a decision during the first conversation.

A complimentary review is simply an opportunity to ask questions and understand what options, if any, may be worth considering.

Schedule a No-Pressure Conversation {{scheduling_link}}

Whenever you are ready, we are here.

Warm regards, {{fsa_name}} {{agency_name}}

This communication is not a recommendation to purchase any specific product.$body$, 'draft', 1),

('e5c00000-0000-4000-8000-000000000009', 'Cross-Sell Life — Email 9 — Complimentary Protection Review', 'email', 'cross_sell_life',
$body$Subject: Your Complimentary Protection Review
Preview: A straightforward conversation with no obligation.

Hi {{first_name}},

As an existing client, you are invited to schedule a complimentary life insurance protection review.

During the review, we can:

* Discuss your current priorities
* Review existing coverage
* Identify important financial responsibilities
* Answer general questions
* Determine whether an updated quote or additional analysis is appropriate

There is no obligation to purchase anything.

Book Your Complimentary Review {{scheduling_link}}

You may also reply to this email if you prefer to begin with a question.

Sincerely, {{fsa_name}} {{agency_name}} {{advisor_phone}} {{advisor_email}}

Any recommendation would be made only after reviewing your individual needs, objectives, and circumstances.$body$, 'draft', 1),

('e5c00000-0000-4000-8000-000000000010', 'Cross-Sell Life — Email 10 — Build a Protection Plan', 'email', 'cross_sell_life',
$body$Subject: Building a Protection Plan Around Your Priorities
Preview: Your coverage discussion should begin with your goals—not a product.

Hi {{first_name}},

A meaningful protection plan should begin with your priorities.

The conversation may include:

* Who depends on your income
* What debts or obligations would remain
* What existing resources are available
* What protection you already have
* What monthly budget is comfortable
* What long-term goals matter most

Only after those questions are understood should specific options be discussed.

We would be glad to help you organize the conversation and determine an appropriate next step.

Start My Protection Review {{scheduling_link}}

Warm regards, {{fsa_name}} {{agency_name}}

This email is educational. It does not recommend any particular carrier, product, coverage amount, or premium.$body$, 'draft', 1),

('e5c00000-0000-4000-8000-000000000011', 'Cross-Sell Life — Email 11 — We Are Here When You Are Ready', 'email', 'cross_sell_life',
$body$Subject: We Are Here Whenever You Are Ready
Preview: No pressure—just an open invitation to review your needs.

Hi {{first_name}},

We understand that life insurance may not be the highest priority on your list today.

Our purpose in reaching out is simply to make sure you know that assistance is available whenever you are ready.

You may schedule a conversation, reply with a question, or ask us to follow up at a more convenient time.

Schedule a Conversation {{scheduling_link}}

Thank you again for being a valued client.

Warm regards, {{fsa_name}} {{agency_name}}

This communication is informational and does not constitute a recommendation.$body$, 'draft', 1),

('e5c00000-0000-4000-8000-000000000012', 'Cross-Sell Life — Email 12 — Final Follow-Up', 'email', 'cross_sell_life',
$body$Subject: One Final Note About Your Protection Review
Preview: This concludes the current outreach.

Hi {{first_name}},

This is our final email in this Cross-Sell Life outreach.

We do not want to overwhelm your inbox. If now is not the right time to review life insurance, we completely understand.

If you would still like to speak with us, you may schedule a conversation below or simply reply to this email.

Schedule a Conversation {{scheduling_link}}

Thank you for your time and for allowing {{agency_name}} to serve you.

Warm regards, {{fsa_name}} {{agency_name}} {{advisor_phone}} {{advisor_email}}

This email concludes the current marketing outreach. Future communications will follow your recorded communication preferences and applicable consent. You may unsubscribe from marketing email using the link below.$body$, 'draft', 1)
on conflict (id) do nothing;

-- ── SMS (12) — channel 'sms', category 'cross_sell_life' ────────────────────
insert into comm_templates (id, name, channel, category, body, approval_status, version) values
('d5c00000-0000-4000-8000-000000000001', 'Cross-Sell Life — SMS 1 — Client Appreciation', 'sms', 'cross_sell_life',
$body$Hi {{first_name}}, this is {{fsa_name}} with {{agency_name}}. Thank you for being our client. We are offering existing clients a complimentary life insurance protection review. Reply REVIEW for details. Reply STOP to opt out.$body$, 'draft', 1),
('d5c00000-0000-4000-8000-000000000002', 'Cross-Sell Life — SMS 2 — Complimentary Protection Review', 'sms', 'cross_sell_life',
$body$Hi {{first_name}}, as an existing client, you are invited to a complimentary life insurance review. There is no obligation. Reply REVIEW to schedule or reply with a question. Reply STOP to opt out.$body$, 'draft', 1),
('d5c00000-0000-4000-8000-000000000003', 'Cross-Sell Life — SMS 3 — Life Changes', 'sms', 'cross_sell_life',
$body$Hi {{first_name}}, marriage, children, a new home, career changes, or new financial responsibilities may affect life insurance needs. Reply REVIEW if you would like to talk. Reply STOP to opt out.$body$, 'draft', 1),
('d5c00000-0000-4000-8000-000000000004', 'Cross-Sell Life — SMS 4 — Affordability', 'sms', 'cross_sell_life',
$body$Hi {{first_name}}, life insurance costs vary based on several factors and may be different from what people expect. Reply INFO to ask a question or REVIEW to schedule. Reply STOP to opt out.$body$, 'draft', 1),
('d5c00000-0000-4000-8000-000000000005', 'Cross-Sell Life — SMS 5 — Family Protection', 'sms', 'cross_sell_life',
$body$Hi {{first_name}}, life insurance may help protect income, housing, debt, education goals, and other family responsibilities. Reply REVIEW for a complimentary conversation. Reply STOP to opt out.$body$, 'draft', 1),
('d5c00000-0000-4000-8000-000000000006', 'Cross-Sell Life — SMS 6 — Employer Coverage', 'sms', 'cross_sell_life',
$body$Hi {{first_name}}, do you know whether your life insurance through work would continue if you changed jobs? We can help you review the general questions to consider. Reply REVIEW. Reply STOP to opt out.$body$, 'draft', 1),
('d5c00000-0000-4000-8000-000000000007', 'Cross-Sell Life — SMS 7 — Coverage Questions', 'sms', 'cross_sell_life',
$body$Hi {{first_name}}, do you have questions about life insurance, existing coverage, or how a protection review works? Reply here and we will be happy to help. Reply STOP to opt out.$body$, 'draft', 1),
('d5c00000-0000-4000-8000-000000000008', 'Cross-Sell Life — SMS 8 — No-Pressure Review', 'sms', 'cross_sell_life',
$body$Hi {{first_name}}, you do not have to make a decision during a protection review. It is simply a no-pressure conversation about your needs and questions. Reply REVIEW to schedule. Reply STOP to opt out.$body$, 'draft', 1),
('d5c00000-0000-4000-8000-000000000009', 'Cross-Sell Life — SMS 9 — Schedule a Review', 'sms', 'cross_sell_life',
$body$Hi {{first_name}}, we still have appointments available for complimentary life insurance reviews. Reply REVIEW and we will help you choose a convenient time. Reply STOP to opt out.$body$, 'draft', 1),
('d5c00000-0000-4000-8000-000000000010', 'Cross-Sell Life — SMS 10 — Request Information', 'sms', 'cross_sell_life',
$body$Hi {{first_name}}, would you like general life insurance information, an appointment, or a future follow-up? Reply INFO, REVIEW, or LATER. Reply STOP to opt out.$body$, 'draft', 1),
('d5c00000-0000-4000-8000-000000000011', 'Cross-Sell Life — SMS 11 — Still Interested?', 'sms', 'cross_sell_life',
$body$Hi {{first_name}}, just checking whether a life insurance protection review is still of interest. Reply YES, LATER, or NO so we can update your preferences. Reply STOP to opt out.$body$, 'draft', 1),
('d5c00000-0000-4000-8000-000000000012', 'Cross-Sell Life — SMS 12 — Final Check-In', 'sms', 'cross_sell_life',
$body$Hi {{first_name}}, this is our final Cross-Sell Life follow-up. If you would ever like to review your options, we are here to help. Thank you for being our client. Reply STOP to opt out.$body$, 'draft', 1)
on conflict (id) do nothing;

-- ── AI conversation openers (7) — channel 'sms' (conversational), category 'cross_sell_life_ai' ──
insert into comm_templates (id, name, channel, category, body, approval_status, version) values
('c5c00000-0000-4000-8000-000000000001', 'Cross-Sell Life — AI 1 — Existing Client Welcome', 'sms', 'cross_sell_life_ai',
$body$Hi {{first_name}}, I am the automated assistant for {{fsa_name}} at {{agency_name}}. Because you are an existing client, we wanted to offer you a complimentary life insurance protection review. Are you mainly interested in asking a question, scheduling a review, or receiving general information?$body$, 'draft', 1),
('c5c00000-0000-4000-8000-000000000002', 'Cross-Sell Life — AI 2 — Life-Change Discovery', 'sms', 'cross_sell_life_ai',
$body$Hi {{first_name}}, since you became a client, have there been any major changes such as marriage, children, a home purchase, a job change, business ownership, retirement planning, or new financial responsibilities?$body$, 'draft', 1),
('c5c00000-0000-4000-8000-000000000003', 'Cross-Sell Life — AI 3 — Protection Discovery', 'sms', 'cross_sell_life_ai',
$body$Hi {{first_name}}, when people review life insurance, they often consider income, housing, debt, dependents, education goals, existing coverage, and other long-term responsibilities. Which area is most important to you?$body$, 'draft', 1),
('c5c00000-0000-4000-8000-000000000004', 'Cross-Sell Life — AI 4 — Existing Coverage Review', 'sms', 'cross_sell_life_ai',
$body$Hi {{first_name}}, do you currently have life insurance through work, an individually owned policy, both, or are you unsure?$body$, 'draft', 1),
('c5c00000-0000-4000-8000-000000000005', 'Cross-Sell Life — AI 5 — Objection Handling', 'sms', 'cross_sell_life_ai',
$body$Hi {{first_name}}, a lot of people put a review off for very understandable reasons. Is there anything specific holding you back that I can help clarify?$body$, 'draft', 1),
('c5c00000-0000-4000-8000-000000000006', 'Cross-Sell Life — AI 6 — Scheduling and Next Steps', 'sms', 'cross_sell_life_ai',
$body$Hi {{first_name}}, I can help you schedule a complimentary life insurance protection review. Would you prefer a phone call, virtual meeting, or in-person appointment if available?$body$, 'draft', 1),
('c5c00000-0000-4000-8000-000000000007', 'Cross-Sell Life — AI 7 — Respectful Close or Future Follow-Up', 'sms', 'cross_sell_life_ai',
$body$Hi {{first_name}}, thank you for your time. Would you like us to schedule a review, check back at a later date, or close this life insurance follow-up for now?$body$, 'draft', 1)
on conflict (id) do nothing;

-- ── The campaign (status 'draft', version 1) ────────────────────────────────
insert into xsell_life_campaigns (id, family_key, version, name, description, objective, status, purpose, created_by) values
('f5c00000-0000-4000-8000-000000000001', 'f5c00000-0000-4000-8000-0000000000f0', 1,
 'Cross-Sell Life',
 'A 180-day, 35-touch multi-channel campaign inviting existing non-life agency clients to a complimentary life insurance protection review.',
 'Move interested existing clients into the quote, application, and policy workflows via a compliant, education-first cross-sell cadence.',
 'draft', 'CLIENT_CARE_CROSS_SELL', 'seed')
on conflict (id) do nothing;

-- ── The 35-touch timeline (spec §6), linking templates + playbooks by touch ──
insert into xsell_life_campaign_touches (campaign_id, touch_no, day_offset, kind, template_id, playbook_key, asset_label) values
('f5c00000-0000-4000-8000-000000000001', 1,  1,   'email',            'e5c00000-0000-4000-8000-000000000001', null, 'Email 1 — Thank You for Being Our Client'),
('f5c00000-0000-4000-8000-000000000001', 2,  3,   'sms',              'd5c00000-0000-4000-8000-000000000001', null, 'SMS 1 — Client Appreciation'),
('f5c00000-0000-4000-8000-000000000001', 3,  7,   'ai_conversation',  'c5c00000-0000-4000-8000-000000000001', 'existing_client_welcome', 'AI 1 — Existing Client Welcome'),
('f5c00000-0000-4000-8000-000000000001', 4,  12,  'email',            'e5c00000-0000-4000-8000-000000000002', null, 'Email 2 — Have You Reviewed Your Life Coverage?'),
('f5c00000-0000-4000-8000-000000000001', 5,  18,  'sms',              'd5c00000-0000-4000-8000-000000000002', null, 'SMS 2 — Complimentary Protection Review'),
('f5c00000-0000-4000-8000-000000000001', 6,  24,  'advisor_outreach', null, null, 'Advisor 1 — Relationship Check-In'),
('f5c00000-0000-4000-8000-000000000001', 7,  30,  'email',            'e5c00000-0000-4000-8000-000000000003', null, 'Email 3 — Life Changes'),
('f5c00000-0000-4000-8000-000000000001', 8,  36,  'sms',              'd5c00000-0000-4000-8000-000000000003', null, 'SMS 3 — Life Changes'),
('f5c00000-0000-4000-8000-000000000001', 9,  42,  'ai_conversation',  'c5c00000-0000-4000-8000-000000000002', 'life_change_discovery', 'AI 2 — Life-Change Discovery'),
('f5c00000-0000-4000-8000-000000000001', 10, 48,  'email',            'e5c00000-0000-4000-8000-000000000004', null, 'Email 4 — Life Insurance Myths'),
('f5c00000-0000-4000-8000-000000000001', 11, 54,  'sms',              'd5c00000-0000-4000-8000-000000000004', null, 'SMS 4 — Affordability'),
('f5c00000-0000-4000-8000-000000000001', 12, 60,  'email',            'e5c00000-0000-4000-8000-000000000005', null, 'Email 5 — Protecting Income and Family'),
('f5c00000-0000-4000-8000-000000000001', 13, 66,  'ai_conversation',  'c5c00000-0000-4000-8000-000000000003', 'protection_discovery', 'AI 3 — Protection Discovery'),
('f5c00000-0000-4000-8000-000000000001', 14, 72,  'sms',              'd5c00000-0000-4000-8000-000000000005', null, 'SMS 5 — Family Protection'),
('f5c00000-0000-4000-8000-000000000001', 15, 78,  'email',            'e5c00000-0000-4000-8000-000000000006', null, 'Email 6 — Employer Coverage'),
('f5c00000-0000-4000-8000-000000000001', 16, 84,  'advisor_outreach', null, null, 'Advisor 2 — Needs Discovery'),
('f5c00000-0000-4000-8000-000000000001', 17, 90,  'sms',              'd5c00000-0000-4000-8000-000000000006', null, 'SMS 6 — Employer Coverage'),
('f5c00000-0000-4000-8000-000000000001', 18, 96,  'ai_conversation',  'c5c00000-0000-4000-8000-000000000004', 'existing_coverage_review', 'AI 4 — Existing Coverage Review'),
('f5c00000-0000-4000-8000-000000000001', 19, 102, 'email',            'e5c00000-0000-4000-8000-000000000007', null, 'Email 7 — Understanding Coverage Needs'),
('f5c00000-0000-4000-8000-000000000001', 20, 108, 'sms',              'd5c00000-0000-4000-8000-000000000007', null, 'SMS 7 — Coverage Questions'),
('f5c00000-0000-4000-8000-000000000001', 21, 114, 'email',            'e5c00000-0000-4000-8000-000000000008', null, 'Email 8 — Why People Wait'),
('f5c00000-0000-4000-8000-000000000001', 22, 120, 'sms',              'd5c00000-0000-4000-8000-000000000008', null, 'SMS 8 — No-Pressure Review'),
('f5c00000-0000-4000-8000-000000000001', 23, 126, 'ai_conversation',  'c5c00000-0000-4000-8000-000000000005', 'objection_handling', 'AI 5 — Objection Handling'),
('f5c00000-0000-4000-8000-000000000001', 24, 132, 'email',            'e5c00000-0000-4000-8000-000000000009', null, 'Email 9 — Complimentary Protection Review'),
('f5c00000-0000-4000-8000-000000000001', 25, 138, 'sms',              'd5c00000-0000-4000-8000-000000000009', null, 'SMS 9 — Schedule a Review'),
('f5c00000-0000-4000-8000-000000000001', 26, 144, 'advisor_outreach', null, null, 'Advisor 3 — Personal Review Invitation'),
('f5c00000-0000-4000-8000-000000000001', 27, 150, 'email',            'e5c00000-0000-4000-8000-000000000010', null, 'Email 10 — Build a Protection Plan'),
('f5c00000-0000-4000-8000-000000000001', 28, 156, 'sms',              'd5c00000-0000-4000-8000-000000000010', null, 'SMS 10 — Request Information'),
('f5c00000-0000-4000-8000-000000000001', 29, 162, 'ai_conversation',  'c5c00000-0000-4000-8000-000000000006', 'scheduling_next_steps', 'AI 6 — Scheduling and Next Steps'),
('f5c00000-0000-4000-8000-000000000001', 30, 166, 'email',            'e5c00000-0000-4000-8000-000000000011', null, 'Email 11 — We Are Here When You Are Ready'),
('f5c00000-0000-4000-8000-000000000001', 31, 170, 'sms',              'd5c00000-0000-4000-8000-000000000011', null, 'SMS 11 — Still Interested?'),
('f5c00000-0000-4000-8000-000000000001', 32, 174, 'advisor_outreach', null, null, 'Advisor 4 — Final Personal Outreach'),
('f5c00000-0000-4000-8000-000000000001', 33, 176, 'email',            'e5c00000-0000-4000-8000-000000000012', null, 'Email 12 — Final Follow-Up'),
('f5c00000-0000-4000-8000-000000000001', 34, 178, 'sms',              'd5c00000-0000-4000-8000-000000000012', null, 'SMS 12 — Final Check-In'),
('f5c00000-0000-4000-8000-000000000001', 35, 180, 'ai_conversation',  'c5c00000-0000-4000-8000-000000000007', 'respectful_close', 'AI 7 — Respectful Close or Future Follow-Up')
on conflict (campaign_id, touch_no) do nothing;

-- ── ROLLBACK (manual) ───────────────────────────────────────────────────────
--   delete from xsell_life_campaign_touches where campaign_id = 'f5c00000-0000-4000-8000-000000000001';
--   delete from xsell_life_campaigns where id = 'f5c00000-0000-4000-8000-000000000001';
--   delete from comm_templates where category in ('cross_sell_life','cross_sell_life_ai');
