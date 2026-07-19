-- 019_referral_contact_fields.sql
-- STEP 1 FIX (docs/legacy-port.md §4 Step 1 - fix the erroring routes).
--
-- The referral intake forms (public, staff, and partner) all collect the referred
-- contact's email + phone, ReferralCreateSchema validates them, and the PUBLIC
-- intake route (api/public/refer) INSERTS them into `referrals`. But the referrals
-- table (009) never had those columns, so every public referral submission threw
-- "column referred_email does not exist". The staff/partner routes silently
-- dropped the captured contact details.
--
-- Add the two columns so the collected contact info persists (and the public route
-- stops erroring). Non-substantive contact fields only - no securities data.
--
-- NOTE: comments are on their own lines and contain no semicolons.

alter table referrals add column if not exists referred_email text;
alter table referrals add column if not exists referred_phone text;
