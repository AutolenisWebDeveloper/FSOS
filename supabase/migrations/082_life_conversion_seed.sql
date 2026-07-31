-- ─────────────────────────────────────────────────────────
-- Migration: 082_life_conversion_seed
--
-- Seeds the Life Conversion Campaign: one life_campaigns row (status 'draft'), its 20
-- life_campaign_touches (spec §5), and the §14 message assets as DRAFT comm_templates
-- (7 emails, 6 SMS, 5 AI conversation starters).
--
-- "Final copy" (spec §1) means engineering does NOT rewrite the wording — it does NOT skip
-- approval. Every template lands as approval_status='draft' and must pass the existing human
-- approval gate before the campaign can dispatch it (ADR-023); sendThroughGate() refuses an
-- unapproved template regardless. The bodies are verbatim §14 copy; only merge-token SYNTAX
-- is mapped to the repo-native snake_case tokens ({{FirstName}}→{{first_name}}, AdvisorName→
-- fsa_name, AgencyName→agency_name, SchedulingLink→scheduling_link, AdvisorPhone→advisor_phone,
-- AdvisorEmail→advisor_email) so tokens actually resolve — the delivered message is identical.
--
-- Fixed UUIDs make this fully idempotent (re-run = no-op via primary-key / natural-key conflict).
-- Transaction-safe; no explicit BEGIN/COMMIT.
--
-- Checkpoint 2 (spec §0.6/§14) — the §5 asset NAMES read "conversion-specific" while this
-- finalized copy is framed as a general complimentary policy review — remains OPEN for
-- compliance sign-off. Per §1 the copy is implemented verbatim meanwhile; do NOT rewrite it.
-- ─────────────────────────────────────────────────────────

-- ── Emails (7) — channel 'email', category 'life_conversion' ────────────────
insert into comm_templates (id, name, channel, category, body, approval_status, version) values
('e1c00000-0000-4000-8000-000000000001', 'Life Conversion — Email #1 — Welcome & Complimentary Policy Review', 'email', 'life_conversion',
$body$Subject: Let's Review Your Life Insurance Coverage
Preview: A quick review can help ensure your coverage still aligns with your goals.

Hi {{first_name}},

I hope you're doing well.

Life changes over time, and your life insurance should be reviewed periodically to make sure it continues to support the people and goals that matter most to you.

As part of our ongoing commitment to our clients, we'd like to offer you a complimentary life insurance review. During this review, we'll discuss your current coverage, answer any questions you may have, and determine whether your existing policy still meets your needs.

We'll also review any options that may be available under your policy and discuss how recent life changes—such as marriage, children, a new home, career changes, or retirement planning—may affect your protection strategy.

This review is simply an opportunity to make sure you're informed. There is no obligation.

If you'd like to schedule a convenient time, simply click below.

Schedule Your Review {{scheduling_link}}

If you have any questions before then, simply reply to this email or call us anytime.

We appreciate the opportunity to serve you and look forward to speaking with you.

Sincerely, {{fsa_name}} {{agency_name}} {{advisor_phone}} {{advisor_email}}

This email is provided for educational purposes and to invite you to review your existing coverage. Any recommendations will be based on your individual needs, objectives, and policy provisions after a personal consultation.$body$, 'draft', 1),

('e1c00000-0000-4000-8000-000000000002', 'Life Conversion — Email #2 — Understanding Your Options', 'email', 'life_conversion',
$body$Subject: Have You Reviewed Your Life Insurance Recently?
Preview: Your needs may have changed—and your policy deserves another look.

Hi {{first_name}},

Many people purchase life insurance and then rarely look at it again.

However, over time, families grow, financial responsibilities change, retirement plans evolve, and personal priorities shift. Because of these changes, it's often beneficial to periodically review your coverage.

A life insurance review gives you the opportunity to:

* Confirm your current coverage still fits your goals.
* Better understand the features of your existing policy.
* Discuss any options that may be available under your policy.
* Ask questions about your current protection strategy.

Even if you ultimately decide to make no changes, you'll have greater confidence that your coverage continues to reflect your current needs.

If you've been thinking about reviewing your policy—or simply have questions—we'd be happy to help.

Schedule Your Complimentary Review {{scheduling_link}}

If now isn't the right time, simply reply to this email and let us know. We're always happy to assist whenever you're ready.

Thank you for trusting {{agency_name}}.

Warm regards, {{fsa_name}} {{agency_name}} {{advisor_phone}} {{advisor_email}}

Any discussion regarding insurance options will be individualized based on your circumstances and the terms of your existing policy. Availability of policy features, including any conversion privileges, depends on your specific contract.$body$, 'draft', 1),

('e1c00000-0000-4000-8000-000000000003', 'Life Conversion — Email #3 — Has Life Changed?', 'email', 'life_conversion',
$body$Subject: Has Anything Changed Since You Purchased Your Policy?
Preview: A few minutes today can help ensure your coverage still reflects your life today.

Hi {{first_name}},

When was the last time you reviewed your life insurance?

For many people, life has changed significantly since they first purchased their policy.

Perhaps you've:

* Gotten married.
* Welcomed children or grandchildren.
* Purchased a home.
* Changed careers.
* Started planning for retirement.
* Paid off major debts.
* Experienced changes in your financial goals.

Any of these milestones may be a good reason to review your current coverage.

A review doesn't mean you're making changes. It's simply an opportunity to understand your policy, discuss your goals, and determine whether your current protection still aligns with where you are today.

If it's been a while since your last review, we'd be happy to help.

Schedule Your Complimentary Policy Review {{scheduling_link}}

If you have questions first, simply reply to this email. We're here to help.

Thank you, {{fsa_name}} {{agency_name}}

Recommendations, if any, will be based on your personal circumstances, financial objectives, and the provisions of your existing policy.$body$, 'draft', 1),

('e1c00000-0000-4000-8000-000000000004', 'Life Conversion — Email #4 — Common Questions', 'email', 'life_conversion',
$body$Subject: Common Questions About Your Life Insurance
Preview: Here are answers to a few questions we hear most often.

Hi {{first_name}},

Many clients tell us they aren't sure whether they should review their life insurance because they still have unanswered questions.

Here are a few we hear most often.

Do I need to review my policy if nothing has changed? Even if your circumstances seem the same, it's a good idea to periodically understand how your policy works and confirm it still aligns with your goals.

Will a review require me to make changes? No. A review is simply an opportunity to better understand your current coverage and discuss any available options.

How long does the review take? Most reviews take about 20–30 minutes.

Can I ask questions without any obligation? Absolutely. Our goal is to help you understand your coverage so you can make informed decisions.

If you've been meaning to review your policy, we'd love to help.

Schedule Your Review {{scheduling_link}}

Or simply reply to this email with your questions—we'll be happy to assist.

Sincerely, {{fsa_name}} {{agency_name}}

Insurance products and policy features vary. Any discussion of available options will depend on your specific policy and individual circumstances.$body$, 'draft', 1),

('e1c00000-0000-4000-8000-000000000005', 'Life Conversion — Email #5 — Why Review Now?', 'email', 'life_conversion',
$body$Subject: A Small Review Today Can Make a Big Difference Tomorrow
Preview: Taking time to review your coverage today can provide greater confidence for the future.

Hi {{first_name}},

Life insurance is designed to protect the people who matter most.

As life evolves, reviewing your coverage periodically can help ensure it continues to support your family's needs and your long-term financial goals.

A policy review may help you:

* Better understand your current benefits.
* Confirm your coverage still fits your situation.
* Identify questions you may want answered.
* Learn about any options that may be available under your policy.

Even if you decide your current policy remains the best fit, you'll have the confidence of knowing your decision is based on current information.

We're here to make the process simple, convenient, and pressure-free.

Reserve Your Complimentary Review {{scheduling_link}}

If you'd rather speak with us directly, simply reply to this email or call us at {{advisor_phone}}.

Thank you for allowing us to serve you.

Warm regards, {{fsa_name}} {{agency_name}}

This communication is intended to encourage a review of your existing coverage and is not a recommendation to purchase, replace, or modify any insurance product. Any recommendations will be made only after reviewing your individual needs and circumstances.$body$, 'draft', 1),

('e1c00000-0000-4000-8000-000000000006', 'Life Conversion — Email #6 — We''d Still Love to Help', 'email', 'life_conversion',
$body$Subject: We'd Still Love the Opportunity to Review Your Coverage
Preview: If you've been meaning to review your life insurance, we're here whenever you're ready.

Hi {{first_name}},

Over the past few weeks, we've reached out because we believe it's important for our clients to periodically review their life insurance coverage.

If you haven't had a chance to respond yet, that's completely understandable.

Our goal isn't to pressure you—it's simply to make sure you have the opportunity to:

* Review your current policy.
* Ask questions about your coverage.
* Discuss any changes in your life or financial goals.
* Understand any options that may be available under your policy.

Even if you ultimately decide to keep everything exactly as it is, a review can provide valuable peace of mind.

If you'd like to schedule a convenient time, we're here to help.

Schedule Your Complimentary Review {{scheduling_link}}

Or simply reply to this email, and we'll be happy to reach out at a time that works best for you.

Thank you for trusting {{agency_name}}. We appreciate the opportunity to serve you.

Sincerely, {{fsa_name}} {{agency_name}} {{advisor_phone}} {{advisor_email}}

Insurance needs change over time. Any recommendations discussed during your review will be based on your individual circumstances, financial objectives, and the provisions of your existing policy.$body$, 'draft', 1),

('e1c00000-0000-4000-8000-000000000007', 'Life Conversion — Email #7 — Final Invitation', 'email', 'life_conversion',
$body$Subject: Final Invitation to Schedule Your Complimentary Policy Review
Preview: We'll close this review invitation soon, but we're always here if you need us.

Hi {{first_name}},

This is our final invitation to schedule your complimentary life insurance review as part of this outreach campaign.

If you've already reviewed your coverage or determined that no action is needed, thank you for your time.

If not, we'd still be happy to meet with you.

A brief review can help you better understand your current policy, answer any remaining questions, and confirm that your coverage continues to align with your goals and the needs of those you care about most.

If you'd like to schedule a review, simply click below.

Schedule Your Review {{scheduling_link}}

If now isn't the right time, that's perfectly okay. We'll conclude this outreach for now, and you're always welcome to contact us whenever you have questions or would like to review your coverage in the future.

Thank you again for the opportunity to serve you. We appreciate your trust and look forward to assisting you whenever you need us.

Warm regards, {{fsa_name}} {{agency_name}} {{advisor_phone}} {{advisor_email}}

This email concludes this review invitation campaign. Future communications will be sent according to your communication preferences and any applicable consent you've provided. If you no longer wish to receive marketing emails from us, you may unsubscribe using the link provided in our emails. Transactional or legally required communications may still be sent when applicable.$body$, 'draft', 1)
on conflict (id) do nothing;

-- ── SMS (6) — channel 'sms', category 'life_conversion' ─────────────────────
insert into comm_templates (id, name, channel, category, body, approval_status, version) values
('d1c00000-0000-4000-8000-000000000001', 'Life Conversion — SMS #1 — Initial Outreach', 'sms', 'life_conversion',
$body$Hi {{first_name}}, this is {{fsa_name}} with {{agency_name}}. Your life insurance policy may include a conversion option worth reviewing. Would you like to schedule a complimentary policy review? Reply YES or use {{scheduling_link}}. Reply STOP to opt out.$body$, 'draft', 1),
('d1c00000-0000-4000-8000-000000000002', 'Life Conversion — SMS #2 — Education', 'sms', 'life_conversion',
$body$Hi {{first_name}}, many life insurance policies include features that clients don't realize they have. A quick review can help you understand your policy and any available options. Interested? {{scheduling_link}} Reply STOP to opt out.$body$, 'draft', 1),
('d1c00000-0000-4000-8000-000000000003', 'Life Conversion — SMS #3 — Life Changes', 'sms', 'life_conversion',
$body$Hi {{first_name}}, have your family, finances, or goals changed since you purchased your life insurance? If so, now may be a good time to review your coverage. Schedule here: {{scheduling_link}}. Reply STOP to opt out.$body$, 'draft', 1),
('d1c00000-0000-4000-8000-000000000004', 'Life Conversion — SMS #4 — Questions', 'sms', 'life_conversion',
$body$Hi {{first_name}}, do you have questions about your life insurance or whether your policy includes a conversion option? We're happy to help. Reply to this message or schedule a review at {{scheduling_link}}. Reply STOP to opt out.$body$, 'draft', 1),
('d1c00000-0000-4000-8000-000000000005', 'Life Conversion — SMS #5 — Friendly Reminder', 'sms', 'life_conversion',
$body$Hi {{first_name}}, just checking in. If you'd still like to review your life insurance and discuss any available conversion options, we'd be happy to meet with you. Schedule anytime: {{scheduling_link}}. Reply STOP to opt out.$body$, 'draft', 1),
('d1c00000-0000-4000-8000-000000000006', 'Life Conversion — SMS #6 — Final Invitation', 'sms', 'life_conversion',
$body$Hi {{first_name}}, this is our final reminder to schedule your complimentary life insurance review as part of this campaign. If you'd like to discuss your policy or any available conversion options, we're here to help: {{scheduling_link}}. Reply STOP to opt out.$body$, 'draft', 1)
on conflict (id) do nothing;

-- ── AI conversation starters (5) — channel 'sms' (conversational), category 'life_conversion_ai' ──
insert into comm_templates (id, name, channel, category, body, approval_status, version) values
('c1c00000-0000-4000-8000-000000000001', 'Life Conversion — Conversation #1 — Initial Check-In', 'sms', 'life_conversion_ai',
$body$Hi {{first_name}}, it's {{fsa_name}}'s assistant. Do you have a few minutes this week to review your life insurance?$body$, 'draft', 1),
('c1c00000-0000-4000-8000-000000000002', 'Life Conversion — Conversation #2 — Life Changes', 'sms', 'life_conversion_ai',
$body$Hi {{first_name}}, have there been any major life changes since you purchased your life insurance?$body$, 'draft', 1),
('c1c00000-0000-4000-8000-000000000003', 'Life Conversion — Conversation #3 — Questions', 'sms', 'life_conversion_ai',
$body$Hi {{first_name}}, do you have any questions about your current life insurance or your available options?$body$, 'draft', 1),
('c1c00000-0000-4000-8000-000000000004', 'Life Conversion — Conversation #4 — Protection Check', 'sms', 'life_conversion_ai',
$body$Hi {{first_name}}, if something happened to you today, do you feel your family would have the protection they need?$body$, 'draft', 1),
('c1c00000-0000-4000-8000-000000000005', 'Life Conversion — Conversation #5 — Final Invitation', 'sms', 'life_conversion_ai',
$body$Hi {{first_name}}, before we close your review invitation, would you still like to schedule a quick life insurance review?$body$, 'draft', 1)
on conflict (id) do nothing;

-- ── The campaign (status 'draft') ───────────────────────────────────────────
insert into life_campaigns (id, name, status, purpose, created_by) values
('f1c00000-0000-4000-8000-000000000001', 'Life Conversion Campaign', 'draft', 'POLICY_DEADLINE', 'seed')
on conflict (id) do nothing;

-- ── The 20-touch timeline (spec §5), linking templates by touch ─────────────
insert into life_campaign_touches (campaign_id, touch_no, day_offset, kind, template_id, asset_label) values
('f1c00000-0000-4000-8000-000000000001', 1, 1, 'email', 'e1c00000-0000-4000-8000-000000000001', 'Email #1 — Conversion Opportunity Introduction'),
('f1c00000-0000-4000-8000-000000000001', 2, 4, 'sms', 'd1c00000-0000-4000-8000-000000000001', 'SMS #1 — Initial Conversion Outreach'),
('f1c00000-0000-4000-8000-000000000001', 3, 8, 'ai_conversation', 'c1c00000-0000-4000-8000-000000000001', 'Conversation Starter #1 — Initial Check-In'),
('f1c00000-0000-4000-8000-000000000001', 4, 15, 'email', 'e1c00000-0000-4000-8000-000000000002', 'Email #2 — What Life Insurance Conversion Means'),
('f1c00000-0000-4000-8000-000000000001', 5, 24, 'sms', 'd1c00000-0000-4000-8000-000000000002', 'SMS #2 — Conversion Education'),
('f1c00000-0000-4000-8000-000000000001', 6, 35, 'ai_conversation', 'c1c00000-0000-4000-8000-000000000002', 'Conversation Starter #2 — Life Changes'),
('f1c00000-0000-4000-8000-000000000001', 7, 48, 'advisor_outreach', null, 'Advisor Call Task #1'),
('f1c00000-0000-4000-8000-000000000001', 8, 60, 'email', 'e1c00000-0000-4000-8000-000000000003', 'Email #3 — Life Changes and Coverage Needs'),
('f1c00000-0000-4000-8000-000000000001', 9, 75, 'sms', 'd1c00000-0000-4000-8000-000000000003', 'SMS #3 — Coverage and Life-Change Check-In'),
('f1c00000-0000-4000-8000-000000000001', 10, 90, 'ai_conversation', 'c1c00000-0000-4000-8000-000000000003', 'Conversation Starter #3 — Questions About Current Coverage'),
('f1c00000-0000-4000-8000-000000000001', 11, 105, 'email', 'e1c00000-0000-4000-8000-000000000004', 'Email #4 — Common Conversion Questions'),
('f1c00000-0000-4000-8000-000000000001', 12, 120, 'sms', 'd1c00000-0000-4000-8000-000000000004', 'SMS #4 — Conversion Questions Invitation'),
('f1c00000-0000-4000-8000-000000000001', 13, 135, 'advisor_outreach', null, 'Advisor Call Task #2'),
('f1c00000-0000-4000-8000-000000000001', 14, 145, 'email', 'e1c00000-0000-4000-8000-000000000005', 'Email #5 — Reasons to Review Conversion Options Now'),
('f1c00000-0000-4000-8000-000000000001', 15, 152, 'ai_conversation', 'c1c00000-0000-4000-8000-000000000004', 'Conversation Starter #4 — Family Protection Check'),
('f1c00000-0000-4000-8000-000000000001', 16, 158, 'sms', 'd1c00000-0000-4000-8000-000000000005', 'SMS #5 — Conversion Review Reminder'),
('f1c00000-0000-4000-8000-000000000001', 17, 165, 'email', 'e1c00000-0000-4000-8000-000000000006', 'Email #6 — Conversion Window Follow-Up'),
('f1c00000-0000-4000-8000-000000000001', 18, 171, 'ai_conversation', 'c1c00000-0000-4000-8000-000000000005', 'Conversation Starter #5 — Final Conversation Check-In'),
('f1c00000-0000-4000-8000-000000000001', 19, 176, 'sms', 'd1c00000-0000-4000-8000-000000000006', 'SMS #6 — Final Conversion Reminder'),
('f1c00000-0000-4000-8000-000000000001', 20, 180, 'email', 'e1c00000-0000-4000-8000-000000000007', 'Email #7 — Final Conversion Review Invitation')
on conflict (campaign_id, touch_no) do nothing;

-- ── ROLLBACK (manual) ───────────────────────────────────────────────────────
--   delete from life_campaign_touches where campaign_id = 'f1c00000-0000-4000-8000-000000000001';
--   delete from life_campaigns where id = 'f1c00000-0000-4000-8000-000000000001';
--   delete from comm_templates where category in ('life_conversion','life_conversion_ai');
