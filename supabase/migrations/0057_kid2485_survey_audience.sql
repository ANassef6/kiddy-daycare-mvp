-- KID-2485: surveys gain a recipient audience.
--
-- The survey composer now uses the same recipient picker and server-side
-- resolution as activities/newsfeed. The resolved audience is stored on the
-- template:
--   audience_channel    'center' | 'rooms' | 'children'
--   audience_room_ids   JSON array of the picked classroom ids
--   audience_child_ids  JSON array of the resolved child ids
--
-- All three columns are nullable. Existing surveys keep NULL here, which the
-- app treats as center-wide — their pre-change behavior — so no family loses
-- a survey it could already see.
ALTER TABLE form_template ADD COLUMN IF NOT EXISTS audience_channel TEXT;
ALTER TABLE form_template ADD COLUMN IF NOT EXISTS audience_room_ids TEXT;
ALTER TABLE form_template ADD COLUMN IF NOT EXISTS audience_child_ids TEXT;
