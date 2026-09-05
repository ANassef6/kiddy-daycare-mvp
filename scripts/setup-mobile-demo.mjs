#!/usr/bin/env node
// Kiddy mobile demo setup (KID-6/T4). Idempotent; safe to run repeatedly.
//
// 1. Gives the seeded demo accounts a real Supabase GoTrue identity (so the
//    mobile app, which authenticates through the anon key + GoTrue, can sign
//    in with the same demo credentials the web uses) and links it to the app
//    account via account.auth_user_id.
// 2. Seeds "simplified billing" (KID-5/M3) demo rows for the demo daycare:
//    a billing plan per child, two invoices per child (current month issued,
//    previous month paid with a recorded payment), and a saved payment method
//    on the demo parent account — the read-only money view parents get.
// 3. Verifies the whole mobile stack end to end: GoTrue password sign-in
//    (anon key) + PostgREST child list filtered by RLS.
//
// Prereqs: devDeps bcryptjs; a Postgres-mode KIDDY_DATABASE_URL and
// NEXT_PUBLIC_SUPABASE_URL/ANON in .env.local (or the two SUPABASE_* as env).
// Run:   NODE_ENV=development npx tsx scripts/setup-mobile-demo.mjs
// (Set NODE_ENV=development so npm resolves devDeps like `pg`.)

import pg from "pg";
import bcrypt from "bcryptjs";
import fs from "node:fs";
import path from "node:path";
const { Pool } = pg;

function loadEnv() {
  const vals = {};
  const file = path.join(process.cwd(), ".env.local");
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) vals[m[1]] = m[2].trim().replace(/^"+|"+$/g, "");
    }
  }
  return vals;
}

const env = loadEnv();
const DB_URL = (process.env.KIDDY_DATABASE_URL || env.KIDDY_DATABASE_URL || "").split("?")[0];
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

if (!DB_URL || !SUPABASE_URL || !SUPABASE_ANON) {
  console.error("Missing KIDDY_DATABASE_URL / NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  process.exit(1);
}

const pool = new Pool({ connectionString: DB_URL, ssl: { rejectUnauthorized: false }, max: 2 });

const DEMO_ACCOUNTS = [
  { email: "parent@example.test", password: "kiddy-parent", role: "parent" },
  { email: "admin@sunshinedaycare.test", password: "kiddy-admin", role: "owner" },
];

async function ensureGotrueIdentity(account) {
  const u = await pool.query("SELECT id FROM auth.users WHERE email = $1", [account.email]);
  let userId = u.rows[0]?.id ?? null;
  if (!userId) {
    const id = crypto.randomUUID();
    const hash = bcrypt.hashSync(account.password, 10);
    await pool.query(
      `INSERT INTO auth.users
         (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
       VALUES ($1, $2, 'authenticated', 'authenticated', $3, $4, now(),
          $5, '{}', now(), now())`,
      ["00000000-0000-0000-0000-000000000000", id, account.email, hash,
       JSON.stringify({ provider: "email", providers: ["email"] })]
    );
    await pool.query(
      `INSERT INTO auth.identities
         (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
       VALUES ($1, $2, $3, 'email', now(), now(), now())
       ON CONFLICT (provider_id, provider) DO NOTHING`,
      [id, id, JSON.stringify({ sub: id, email: account.email, email_verified: true, phone_verified: false })]
    );
    userId = id;
  }
  // Make sure the email identity exists even when the user predates this script
  // (e.g. a GoTrue signup without an identity row) and report what we have.
  const hasIdentity = await pool.query(
    "SELECT 1 FROM auth.identities WHERE user_id = $1 AND provider = 'email' LIMIT 1",
    [userId]
  );
  if (!hasIdentity.rows[0]) {
    await pool.query(
      `INSERT INTO auth.identities
         (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
       VALUES ($1, $2, $3, 'email', now(), now(), now())`,
      [userId, userId,
       JSON.stringify({ sub: userId, email: account.email, email_verified: true, phone_verified: false })]
    );
  }
  await pool.query("UPDATE public.account SET auth_user_id = $1 WHERE email = $2", [userId, account.email]);
  return userId;
}

const MONTHS = 1000 * 60 * 60 * 24 * 30;

async function ensureBillingDemo() {
  const inst = await pool.query("SELECT id FROM institute ORDER BY created_at LIMIT 1");
  if (!inst.rows[0]) return console.log("No institute — skipping billing seed.");
  const iid = inst.rows[0].id;

  const children = await pool.query(
    "SELECT id, first_name, last_name FROM child WHERE institute_id = $1 AND active = 1 ORDER BY first_name",
    [iid]
  );
  const parent = await pool.query("SELECT id FROM account WHERE email = 'parent@example.test'");

  let invoiceSeq = ((await pool.query("SELECT COUNT(*) c FROM invoice WHERE institute_id = $1", [iid])).rows[0].c);

  for (const child of children.rows) {
    const cid = child.id;
    await pool.query(
      `INSERT INTO billing_plan (id, institute_id, child_id, plan_name, amount_cents, billing_period, currency)
         VALUES ($1, $2, $3, 'Standard', $4, 'monthly', 'USD')
       ON CONFLICT (child_id) DO NOTHING`,
      [crypto.randomUUID(), iid, cid, child.last_name === "Nguyen" && child.first_name === "Leo" ? 80000 : 85000]
    );

    const plan = await pool.query("SELECT amount_cents FROM billing_plan WHERE child_id = $1", [cid]);
    const amount = plan.rows[0].amount_cents;

    // Current month invoice (issued/unpaid) + previous month (paid).
    for (const [offset, status] of [[0, "issued"], [1, "paid"]]) {
      const d = new Date(Date.now() - offset * MONTHS);
      const monthKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      const existing = await pool.query(
        "SELECT id FROM invoice WHERE child_id = $1 AND number LIKE $2 AND status IN ('issued','paid')",
        [cid, `INV-${monthKey.replace("-", "")}%`]
      );
      if (existing.rows[0]) continue;
      invoiceSeq += 1;
      const number = `INV-${monthKey.replace("-", "")}-${String(invoiceSeq).padStart(2, "0")}`;
      const due = new Date(d.getUTCFullYear(), d.getUTCMonth() + 1, 0);
      const invoiceId = crypto.randomUUID();
      await pool.query(
        `INSERT INTO invoice (id, institute_id, child_id, number, description, amount_cents, currency, due_date, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'USD', $7, $8)`,
        [invoiceId, iid, cid, number, `Monthly care — ${monthKey}`, amount, due.toISOString().slice(0, 10), status]
      );
      if (status === "paid") {
        await pool.query(
          `INSERT INTO payment (id, institute_id, invoice_id, account_id, method, reference, amount_cents, paid_at)
           VALUES ($1, $2, $3, $4, 'card', $5, $6, $7)`,
          [crypto.randomUUID(), iid, invoiceId, parent.rows[0].id, `card_demo_${child.id.slice(0, 6)}`,
           amount, new Date(d.getTime() + 5 * 24 * 3600 * 1000).toISOString()]
        );
      }
    }
  }

  if (parent.rows[0]) {
    await pool.query(
      `INSERT INTO payment_method (id, account_id, label, provider, last4, is_default)
       VALUES ($1, $2, 'Visa', 'stripe', '4242', 1)
       ON CONFLICT DO NOTHING`,
      [crypto.randomUUID(), parent.rows[0].id]
    );
  }
}

async function verifyStack(parentEmail, parentPassword) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON },
    body: JSON.stringify({ email: parentEmail, password: parentPassword }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GoTrue sign-in failed (${res.status}): ${body.slice(0, 160)}`);
  }
  const { access_token, user } = await res.json();

  const acct = await fetch(`${SUPABASE_URL}/rest/v1/account?select=id,email,role&auth_user_id=eq.${user.id}&limit=1`, {
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${access_token}` },
  });
  const acctRows = await acct.json();
  const myId = acctRows[0]?.id;
  if (!myId) throw new Error("PostgREST account lookup returned no row (RLS?)");

  const kids = await fetch(
    `${SUPABASE_URL}/rest/v1/child?select=id,first_name,last_name,room(name)&family_member.account_id=eq.${myId}`,
    { headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${access_token}` } }
  );
  const kidRows = await kids.json();
  console.log(`Verified: GoTrue sign-in OK for ${parentEmail}; RLS returned ${kidRows.length} child(ren).`);
  for (const k of kidRows) console.log(`   - ${k.first_name} ${k.last_name} (${k.room?.name ?? "no room"})`);
  return kidRows.length;
}

(async () => {
  for (const a of DEMO_ACCOUNTS) {
    const uid = await ensureGotrueIdentity(a);
    console.log(`GoTrue identity ready: ${a.email} (auth.users=${uid.slice(0, 8)}…)`);
  }
  await ensureBillingDemo();
  console.log("Billing demo rows ensured (plans, invoices, payments, payment method).");
  const count = await verifyStack(DEMO_ACCOUNTS[0].email, DEMO_ACCOUNTS[0].password);
  if (count === 0) {
    console.error("RLS returned zero children — check family_member/auth_user_id linkage.");
    process.exit(1);
  }
  await pool.end();
  console.log("Demo setup complete. parent@example.test / kiddy-parent can now sign in on mobile.");
})().catch(async (e) => {
  console.error("FAILED:", e.message);
  try { await pool.end(); } catch {}
  process.exit(1);
});