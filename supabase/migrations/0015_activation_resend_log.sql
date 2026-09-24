-- KID-113: audit log for admin "Resend activation" actions.
-- One row per attempt (sent / rate_limited / failed / no_account /
-- already_active) so throttling and abuse are visible without extra tooling.

CREATE TABLE IF NOT EXISTS activation_resend_log (
  id TEXT PRIMARY KEY,
  target_email TEXT NOT NULL,
  admin_account_id TEXT REFERENCES account(id) ON DELETE SET NULL,
  channel TEXT NOT NULL DEFAULT 'supabase',
  status TEXT NOT NULL,
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activation_resend_email ON activation_resend_log (target_email, created_at);
CREATE INDEX IF NOT EXISTS idx_activation_resend_admin ON activation_resend_log (admin_account_id, created_at);
