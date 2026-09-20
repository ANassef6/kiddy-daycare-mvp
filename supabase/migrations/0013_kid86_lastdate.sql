-- KID-86 items 3, 4, 9
-- Child status for filtering, and last-date withdrawal for child + staff profiles.

ALTER TABLE child ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE child ADD COLUMN IF NOT EXISTS last_date TEXT;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS last_date TEXT;

CREATE INDEX IF NOT EXISTS idx_child_status ON child (institute_id, status);
CREATE INDEX IF NOT EXISTS idx_child_last_date ON child (last_date);
CREATE INDEX IF NOT EXISTS idx_staff_last_date ON staff (last_date);
