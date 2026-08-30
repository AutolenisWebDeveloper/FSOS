-- 133_workshop_sender_address.sql
-- WS-025 — the real CAN-SPAM physical mailing address, supplied by the owner.
--
-- Migration 040 seeded workshop_comms_config.sender_physical_address as a clearly-marked
-- PLACEHOLDER, and Batch 7 made that placeholder fail closed: while it is present, the
-- engine DEFERS every MARKETING-tier workshop email with reason 'sender_address_placeholder'
-- (audited, retryable) and sends nothing. Transactional reminder-class receipts are not
-- commercial mail and were never held by it.
--
-- Supplying the address is a DATA change, which is what this migration performs. It is
-- guarded two ways:
--   • It only rewrites a value that still carries the PLACEHOLDER marker, so a real
--     address set later through the config UI is never clobbered by a re-run.
--   • The column DEFAULT is deliberately left as the placeholder. A fresh install with no
--     config row must still fail closed rather than inherit one practice's address.
update workshop_comms_config
set sender_physical_address = '12800 Westridge Blvd, Ste 114, Frisco, TX 75035',
    updated_at = now()
where sender_physical_address like '[PLACEHOLDER%';
