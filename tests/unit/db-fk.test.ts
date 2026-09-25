// KID-125: unit tests for the foreign-key-violation matcher used by
// registerAction to retry createAccount app-side (authUserId null) when the
// adopted GoTrue id violates account_auth_user_id_fkey.
// Pure-function tests only; the retry itself needs a database.

import { describe, expect, it } from "vitest";
import { isForeignKeyViolation } from "@/lib/db";

describe("isForeignKeyViolation", () => {
  it("matches the live production error text", () => {
    expect(
      isForeignKeyViolation(
        new Error('insert or update on table "account" violates foreign key constraint "account_auth_user_id_fkey"')
      )
    ).toBe(true);
  });

  it("matches the pg 23503 code", () => {
    expect(isForeignKeyViolation({ code: "23503", message: "insert or update on table violates foreign key constraint" })).toBe(
      true
    );
  });

  it("matches the SQLite message", () => {
    expect(isForeignKeyViolation(new Error("FOREIGN KEY constraint failed"))).toBe(true);
  });

  it("rejects unique violations, not-null violations and empty errors", () => {
    expect(isForeignKeyViolation({ code: "23505", message: 'duplicate key value violates unique constraint "account_email_key"' })).toBe(
      false
    );
    expect(isForeignKeyViolation(new Error("NOT NULL constraint failed: account.email"))).toBe(false);
    expect(isForeignKeyViolation(null)).toBe(false);
    expect(isForeignKeyViolation(undefined)).toBe(false);
    expect(isForeignKeyViolation("violates foreign key constraint")).toBe(false);
  });
});
