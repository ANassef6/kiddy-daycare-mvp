-- KID-236: "Enter as admin" — the platform operator's audited, one-click
-- entry into a daycare's own portal (no per-tenant accounts, per the board).
--
-- One row per operator-access event:
--   event = 'enter'   a grant was consumed; an operator-view session started.
--                     Carries the single-use grant `nonce` — the partial
--                     unique index below makes consumption atomic, so a
--                     replayed grant can never start a second session.
--   event = 'exit'    the operator-view session ended via the banner's Exit.
--   event = 'refused' the entry route rejected a grant (expired, wrong host,
--                     replay, non-operator, disabled daycare). `nonce` stays
--                     NULL here so a refusal never consumes the grant it
--                     names.
--
-- institute_id is nullable: refusals of malformed grants may name no tenant
-- with confidence. operator_account_id keeps the FK style of
-- activation_resend_log (0015): SET NULL so removing an account never breaks
-- the audit history.

CREATE TABLE IF NOT EXISTS platform_access_log (
  id TEXT PRIMARY KEY,
  event TEXT NOT NULL CHECK (event IN ('enter', 'exit', 'refused')),
  operator_account_id TEXT REFERENCES account(id) ON DELETE SET NULL,
  operator_email TEXT NOT NULL,
  institute_id TEXT,
  nonce TEXT,
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_access_institute ON platform_access_log (institute_id, created_at);
CREATE INDEX IF NOT EXISTS idx_platform_access_operator ON platform_access_log (operator_email, created_at);

-- Single-use enforcement lives in the schema, not only in application code:
-- two concurrent consumers of the same grant cannot both win the insert.
CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_access_nonce
  ON platform_access_log (nonce)
  WHERE nonce IS NOT NULL;
