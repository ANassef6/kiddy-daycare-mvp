-- KID-43: Curriculum-driven observations.
-- Additive: curriculum tables + learning_observation columns.

CREATE TABLE IF NOT EXISTS curriculum_area (
  id TEXT PRIMARY KEY,
  institute_id TEXT REFERENCES institute(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS curriculum_learning_point (
  id TEXT PRIMARY KEY,
  area_id TEXT NOT NULL REFERENCES curriculum_area(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  age_group TEXT NOT NULL DEFAULT '0-1y',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS curriculum_milestone (
  id TEXT PRIMARY KEY,
  learning_point_id TEXT NOT NULL REFERENCES curriculum_learning_point(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  age_group TEXT NOT NULL DEFAULT '0-1y',
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lp_area ON curriculum_learning_point (area_id);
CREATE INDEX IF NOT EXISTS idx_milestone_lp ON curriculum_milestone (learning_point_id);

ALTER TABLE learning_observation ADD COLUMN IF NOT EXISTS age_group TEXT;
ALTER TABLE learning_observation ADD COLUMN IF NOT EXISTS learning_point_id TEXT REFERENCES curriculum_learning_point(id) ON DELETE SET NULL;
ALTER TABLE learning_observation ADD COLUMN IF NOT EXISTS milestone_id TEXT REFERENCES curriculum_milestone(id) ON DELETE SET NULL;