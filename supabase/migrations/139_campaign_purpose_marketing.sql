-- 139_campaign_purpose_marketing.sql
-- Store Life Conversion and Cross-Sell Life as MARKETING campaigns.
--
-- WHY: owner decisions 6 and 10 (docs/ops/automation-inventory.md §10, 2026-10-02).
--   • Life Conversion was seeded POLICY_DEADLINE (081:35), which the gate treated as transactional:
--     no business suppression, servicing consent, and (before 2026-10-02) no SMS quiet-hours floor.
--   • Cross-Sell Life was seeded CLIENT_CARE_CROSS_SELL (085:52), which is NOT a valid
--     MessagePurpose (src/lib/comms/purpose.ts) — the gate coerced it to "no purpose", so every AI
--     touch was held for missing_purpose_classification.
-- MARKETING is the purpose with full marketing treatment at the gate (marketing consent, business
-- suppression, the quiet-hours floor and Sunday hold, marketing frequency caps). The ticks already
-- dispatch as MARKETING in code (src/lib/life-campaign/tick.ts, src/lib/cross-sell-life/tick.ts);
-- this aligns the stored rows and column defaults so the campaign pages show the truth.
--
-- Config rows only (no client data). Applying it is a production write — owner applies at deploy.
--
-- ROLLBACK:
--   alter table life_campaigns alter column purpose set default 'POLICY_DEADLINE';
--   update life_campaigns set purpose = 'POLICY_DEADLINE', updated_at = now() where purpose = 'MARKETING';
--   alter table xsell_life_campaigns alter column purpose set default 'CLIENT_CARE_CROSS_SELL';
--   update xsell_life_campaigns set purpose = 'CLIENT_CARE_CROSS_SELL', updated_at = now() where purpose = 'MARKETING';

alter table life_campaigns alter column purpose set default 'MARKETING';
update life_campaigns set purpose = 'MARKETING', updated_at = now()
 where purpose is distinct from 'MARKETING';

alter table xsell_life_campaigns alter column purpose set default 'MARKETING';
update xsell_life_campaigns set purpose = 'MARKETING', updated_at = now()
 where purpose is distinct from 'MARKETING';
