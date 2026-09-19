-- KID-53 (part 2): observation curriculum goals, staff status card + contact
-- info, form-response submission funnel, child gender, finance view columns.
-- Additive only — never drops or rewrites existing data.

ALTER TABLE learning_observation ADD COLUMN IF NOT EXISTS curriculum_goal_ids TEXT;

ALTER TABLE staff ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS status_note TEXT;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS status_at TIMESTAMPTZ;

ALTER TABLE form_response ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'new';
ALTER TABLE child ADD COLUMN IF NOT EXISTS gender TEXT;

CREATE TABLE IF NOT EXISTS staff_status (
  id TEXT PRIMARY KEY,
  staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  note TEXT,
  created_by_account_id TEXT REFERENCES account(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_staff_status ON staff_status (staff_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_billing_institute ON child_billing (institute_id, due_date);
CREATE INDEX IF NOT EXISTS idx_form_resp_status ON form_response (form_id, status);