-- KID-480: web push subscriptions (one row per browser/service-worker
-- registration, per account).
--
-- Design decisions:
--   * `endpoint` is the push service URL and is UNIQUE across the whole
--     table: a browser can only register a subscription once, so the
--     subscribe endpoint upserts by endpoint — if a parent re-subscribes in
--     the same or a different account session the row is re-pointed instead
--     of duplicating.
--   * `p256dh`/`auth` carry the client encryption keys (KID-480 uses the
--     `web-push` library's AES128GCM payload, which needs both).
--   * Delivery gating is NOT stored here: per-activity opt-out keeps living
--     in `notification_pref` (migration 0024) under `channel = 'push'`,
--     mirroring the `inapp` channel. A missing push row defaults to enabled
--     for subscribed accounts — granting permission in the browser is the
--     consent event; the settings table lets parents opt out per activity.
--   * Delete the account cascades to its subscriptions (no orphan rows).
--   * Stale subscriptions (410 Gone / 404 from the push service) are deleted
--     lazily by the sender, so no background cleanup job is required.

CREATE TABLE IF NOT EXISTS push_subscription (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_subscription_account
  ON push_subscription (account_id);
