-- Kiddy Round 4: design polish + admin child billing.
-- Idempotent — safe to apply on every app startup alongside earlier migrations.

-- #7b: staff photo placeholder (child already has photo_url).
ALTER TABLE staff ADD COLUMN IF NOT EXISTS photo_url TEXT;

-- #4b: child billing — per-child billing records managed by admins.
CREATE TABLE IF NOT EXISTS child_billing (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL REFERENCES child(id) ON DELETE CASCADE,
  institute_id TEXT NOT NULL REFERENCES institute(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'CAD',
  period TEXT,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_child ON child_billing (child_id);
