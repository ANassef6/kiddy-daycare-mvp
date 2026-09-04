-- Kiddy — M3 simplified billing (KID-5).
--
-- Scope kept deliberately small per brief: one fee/plan per child (no pricing
-- groups), manually-created invoices, a saved payment method per parent account,
-- and a payment record applied to an invoice. Parents see a read-only
-- transaction list of invoices + payments for their children.
-- Dropped from scope: pricing groups, product mgmt, taxes/discounts, subsidy,
-- deposits, auto-invoicing, online payments, tax receipts, payers automation.
-- Idempotent: safe to apply on every app startup.

CREATE TABLE IF NOT EXISTS billing_plan (
  id TEXT PRIMARY KEY,
  institute_id TEXT NOT NULL REFERENCES institute(id) ON DELETE CASCADE,
  child_id TEXT NOT NULL UNIQUE REFERENCES child(id) ON DELETE CASCADE,
  plan_name TEXT NOT NULL DEFAULT 'Standard',
  amount_cents INTEGER NOT NULL DEFAULT 0,
  billing_period TEXT NOT NULL DEFAULT 'monthly',
  currency TEXT NOT NULL DEFAULT 'USD',
  updated_by_account_id TEXT REFERENCES account(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoice (
  id TEXT PRIMARY KEY,
  institute_id TEXT NOT NULL REFERENCES institute(id) ON DELETE CASCADE,
  child_id TEXT NOT NULL REFERENCES child(id) ON DELETE CASCADE,
  number TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  amount_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'issued',
  created_by_account_id TEXT REFERENCES account(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (institute_id, number)
);

CREATE INDEX IF NOT EXISTS idx_invoice_child ON invoice (child_id, created_at DESC);

CREATE TABLE IF NOT EXISTS payment_method (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  provider TEXT,
  last4 TEXT,
  is_default SMALLINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment (
  id TEXT PRIMARY KEY,
  institute_id TEXT NOT NULL REFERENCES institute(id) ON DELETE CASCADE,
  invoice_id TEXT NOT NULL REFERENCES invoice(id) ON DELETE CASCADE,
  account_id TEXT REFERENCES account(id),
  method TEXT NOT NULL DEFAULT 'other',
  reference TEXT,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  paid_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_invoice ON payment (invoice_id, paid_at DESC);