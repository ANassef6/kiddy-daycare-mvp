-- Kiddy — mobile (PostgREST) RLS policies (KID-6/T4).
--
-- The Next.js server talks to Postgres as the table owner (service role),
-- which bypasses RLS entirely, so the web app is unaffected. These policies
-- govern the mobile app, which hits Supabase PostgREST with the anon key and
-- the `authenticated` provilege set (a signed-in GoTrue user).
--
-- Model: an `auth.users` row (auth.uid()) maps to an app `account` row via
-- account.auth_user_id. A parent is linked to children through `family_member`.
-- A parent sees (and, for check-in/out and consent responses, mutates) data that
-- (a) belongs to their own account, or (b) belongs to their linked children.
-- Idempotent: safe to apply on every app startup.
--
-- All money is read-only for parents: invoices, payments and billing plans are
-- created by staff on the web portal, never from the mobile app.

-- Helper: the app account id for the current GoTrue user.
CREATE OR REPLACE FUNCTION public.kiddy_account_id()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT account_id FROM (
    SELECT a.id AS account_id
    FROM account a
    WHERE a.auth_user_id = auth.uid()
    ORDER BY a.created_at
    LIMIT 1
  ) t
  WHERE t.account_id IS NOT NULL;
$$;

-- Helper: the child ids the current user is a parent of.
CREATE OR REPLACE FUNCTION public.kiddy_child_ids()
RETURNS SETOF TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT fm.child_id::text
  FROM family_member fm
  WHERE fm.account_id = public.kiddy_account_id();
$$;

-- ---------------------------------------------------------------------------
-- account
-- ---------------------------------------------------------------------------
ALTER TABLE public.account ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mobile_account_select_own" ON public.account;
CREATE POLICY "mobile_account_select_own" ON public.account
  FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid());
DROP POLICY IF EXISTS "mobile_account_update_own" ON public.account;
CREATE POLICY "mobile_account_update_own" ON public.account
  FOR UPDATE TO authenticated
  USING (auth_user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- family_member
-- ---------------------------------------------------------------------------
ALTER TABLE public.family_member ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mobile_family_select_own" ON public.family_member;
CREATE POLICY "mobile_family_select_own" ON public.family_member
  FOR SELECT TO authenticated
  USING (account_id = public.kiddy_account_id());

-- ---------------------------------------------------------------------------
-- child
-- ---------------------------------------------------------------------------
ALTER TABLE public.child ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mobile_child_select_parent" ON public.child;
CREATE POLICY "mobile_child_select_parent" ON public.child
  FOR SELECT TO authenticated
  USING (id::text = ANY (ARRAY(SELECT public.kiddy_child_ids())));

-- ---------------------------------------------------------------------------
-- check_in (parents check their own children in/out)
-- ---------------------------------------------------------------------------
ALTER TABLE public.check_in ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mobile_checkin_select_parent" ON public.check_in;
CREATE POLICY "mobile_checkin_select_parent" ON public.check_in
  FOR SELECT TO authenticated
  USING (child_id::text = ANY (ARRAY(SELECT public.kiddy_child_ids())));
DROP POLICY IF EXISTS "mobile_checkin_insert_parent" ON public.check_in;
CREATE POLICY "mobile_checkin_insert_parent" ON public.check_in
  FOR INSERT TO authenticated
  WITH CHECK (
    account_id = public.kiddy_account_id()
    AND child_id::text = ANY (ARRAY(SELECT public.kiddy_child_ids()))
  );

-- ---------------------------------------------------------------------------
-- daily_report
-- ---------------------------------------------------------------------------
ALTER TABLE public.daily_report ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mobile_report_select_parent" ON public.daily_report;
CREATE POLICY "mobile_report_select_parent" ON public.daily_report
  FOR SELECT TO authenticated
  USING (child_id::text = ANY (ARRAY(SELECT public.kiddy_child_ids())));

-- ---------------------------------------------------------------------------
-- billing_plan / invoice / payment (read-only for parents)
-- ---------------------------------------------------------------------------
ALTER TABLE public.billing_plan ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mobile_plan_select_parent" ON public.billing_plan;
CREATE POLICY "mobile_plan_select_parent" ON public.billing_plan
  FOR SELECT TO authenticated
  USING (child_id::text = ANY (ARRAY(SELECT public.kiddy_child_ids())));

ALTER TABLE public.invoice ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mobile_invoice_select_parent" ON public.invoice;
CREATE POLICY "mobile_invoice_select_parent" ON public.invoice
  FOR SELECT TO authenticated
  USING (child_id::text = ANY (ARRAY(SELECT public.kiddy_child_ids())));

ALTER TABLE public.payment ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mobile_payment_select_parent" ON public.payment;
CREATE POLICY "mobile_payment_select_parent" ON public.payment
  FOR SELECT TO authenticated
  USING (invoice_id IN (
    SELECT i.id FROM invoice i
    WHERE i.child_id::text = ANY (ARRAY(SELECT public.kiddy_child_ids()))
  ));

ALTER TABLE public.payment_method ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mobile_paymentmeth_select_own" ON public.payment_method;
CREATE POLICY "mobile_paymentmeth_select_own" ON public.payment_method
  FOR SELECT TO authenticated
  USING (account_id = public.kiddy_account_id());

-- ---------------------------------------------------------------------------
-- newsfeed (read-only for parents)
-- ---------------------------------------------------------------------------
ALTER TABLE public.newsfeed_post ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mobile_newsfeed_select_parent" ON public.newsfeed_post;
CREATE POLICY "mobile_newsfeed_select_parent" ON public.newsfeed_post
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM newsfeed_tag t
    WHERE t.post_id = id
      AND t.child_id::text = ANY (ARRAY(SELECT public.kiddy_child_ids()))
  ));

ALTER TABLE public.newsfeed_tag ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mobile_newsfeed_tag_select_parent" ON public.newsfeed_tag;
CREATE POLICY "mobile_newsfeed_tag_select_parent" ON public.newsfeed_tag
  FOR SELECT TO authenticated
  USING (child_id::text = ANY (ARRAY(SELECT public.kiddy_child_ids())));

ALTER TABLE public.newsfeed_comment ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mobile_newsfeed_comment_select" ON public.newsfeed_comment;
CREATE POLICY "mobile_newsfeed_comment_select" ON public.newsfeed_comment
  FOR SELECT TO authenticated
  USING (post_id IN (SELECT id FROM public.newsfeed_post));

-- ---------------------------------------------------------------------------
-- contact
-- ---------------------------------------------------------------------------
ALTER TABLE public.contact ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mobile_contact_select_parent" ON public.contact;
CREATE POLICY "mobile_contact_select_parent" ON public.contact
  FOR SELECT TO authenticated
  USING (child_id::text = ANY (ARRAY(SELECT public.kiddy_child_ids())));

-- ---------------------------------------------------------------------------
-- incident_report (parents read + acknowledge)
-- ---------------------------------------------------------------------------
ALTER TABLE public.incident_report ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mobile_incident_select_parent" ON public.incident_report;
CREATE POLICY "mobile_incident_select_parent" ON public.incident_report
  FOR SELECT TO authenticated
  USING (child_id::text = ANY (ARRAY(SELECT public.kiddy_child_ids())));
DROP POLICY IF EXISTS "mobile_incident_acknowledge" ON public.incident_report;
CREATE POLICY "mobile_incident_acknowledge" ON public.incident_report
  FOR UPDATE TO authenticated
  USING (child_id::text = ANY (ARRAY(SELECT public.kiddy_child_ids())))
  WITH CHECK (child_id::text = ANY (ARRAY(SELECT public.kiddy_child_ids())));

-- ---------------------------------------------------------------------------
-- consent_request (parents read + respond)
-- ---------------------------------------------------------------------------
ALTER TABLE public.consent_request ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mobile_consent_select_parent" ON public.consent_request;
CREATE POLICY "mobile_consent_select_parent" ON public.consent_request
  FOR SELECT TO authenticated
  USING (
    child_id IS NULL
    OR child_id::text = ANY (ARRAY(SELECT public.kiddy_child_ids()))
  );
DROP POLICY IF EXISTS "mobile_consent_respond" ON public.consent_request;
CREATE POLICY "mobile_consent_respond" ON public.consent_request
  FOR UPDATE TO authenticated
  USING (child_id::text = ANY (ARRAY(SELECT public.kiddy_child_ids())))
  WITH CHECK (child_id::text = ANY (ARRAY(SELECT public.kiddy_child_ids())));

-- ---------------------------------------------------------------------------
-- institute / room (read for white-label branding + UI; non-sensitive)
-- ---------------------------------------------------------------------------
ALTER TABLE public.institute ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mobile_institute_select" ON public.institute;
CREATE POLICY "mobile_institute_select" ON public.institute
  FOR SELECT TO authenticated
  USING (true);

ALTER TABLE public.room ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mobile_room_select" ON public.room;
CREATE POLICY "mobile_room_select" ON public.room
  FOR SELECT TO authenticated
  USING (true);

-- Public safety hatch on the helper funcs (SQL function calls are harmless and
-- RLS still gates the underlying tables).
GRANT EXECUTE ON FUNCTION public.kiddy_account_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.kiddy_child_ids() TO authenticated;