-- KID-43: Institute center-details (contact phone + street address).
-- Aligns the Supabase institute table with the local SQLite schema so
-- `updateInstitute` generic patches can write these columns everywhere.
-- Idempotent: safe to apply on every app startup.

ALTER TABLE institute ADD COLUMN IF NOT EXISTS contact TEXT;
ALTER TABLE institute ADD COLUMN IF NOT EXISTS address TEXT;