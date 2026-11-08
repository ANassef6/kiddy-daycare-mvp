-- KID-746: bilingual contract drafts. On createDaycareAction success the
-- platform fills the approved template v1.0 (KID-744 pack, Arabic prevails)
-- with the daycare's own data and stores an Arabic and an English draft HTML
-- through the existing kiddy-public contracts/ path.
--
-- 0038 shipped a single draft_url; the pack produces TWO drafts per daycare,
-- so the row gains one column per language. The legacy draft_url column is
-- untouched (the KID-745 card keeps reading it for rows written by hand; the
-- generated drafts never write it — see setDaycareContractDraft).
--
-- Idempotent: safe to re-apply (ensurePgSchema skips the applied ledger; a
-- manual re-run is a no-op thanks to IF NOT EXISTS).

ALTER TABLE daycare_contract ADD COLUMN IF NOT EXISTS draft_url_ar TEXT;
ALTER TABLE daycare_contract ADD COLUMN IF NOT EXISTS draft_url_en TEXT;
