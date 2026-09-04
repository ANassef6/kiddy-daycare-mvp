-- Kiddy — marketing-site lead capture (M6, KID-8).
--
-- Stores book-a-demo / contact submissions from the public marketing pages.
-- RLS is enabled so anonymous API callers can INSERT a lead but never read or
-- list others. The app's server action writes through the direct pooler
-- connection, which bypasses RLS, so the flow keeps working regardless.

CREATE TABLE IF NOT EXISTS contact_request (
  id TEXT PRIMARY KEY,
  institute_id TEXT REFERENCES institute(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  role TEXT NOT NULL DEFAULT 'parent',
  interest TEXT NOT NULL DEFAULT 'demo',
  message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE contact_request ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contact_request_anon_insert ON contact_request;
CREATE POLICY contact_request_anon_insert ON contact_request
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);