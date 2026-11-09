// KID-1175/F-07: confirmEmailAction must demand GoTrue proof before it flips
// the local `email_confirmed` flag. The old action accepted a bare email —
// any client could confirm any address by name. Now a Supabase access token
// that verifies NOW via auth.getUser AND belongs to exactly the submitted
// email is required (same pattern as syncAppPasswordAfterResetAction,
// KID-495). Unverified calls are uniform no-ops: the same `{ ok: true }` for
// every bad shape, so responses never distinguish accounts (no enumeration)
// and no partial state is ever written.
//
// Pins (all of these fail on the old code, which trusted the email alone):
//   1. a token verifying to the same email sets the flag,
//   2. a token that fails GoTrue verification changes nothing,
//   3. a foreign token (verifies to a DIFFERENT email) changes nothing,
//   4. an empty/missing token changes nothing,
//   5. an unknown email with a valid token is a no-op (never creates state),
//   6. the already-confirmed case is idempotent,
//   7. every response shape is uniform `{ ok: true }`.

process.env.TZ = "UTC";

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAccount, findAccountByEmail } from "@/lib/auth";
import { seedFixture } from "../helpers";

// The rest of lib/actions pulls the whole server surface, so give it the
// session carriers it reaches for at import/call time (confirmEmailAction
// itself touches neither).
const sessionStore = { value: "" };
vi.mock("next/headers", () => ({
  cookies: () => ({ get: () => (sessionStore.value ? { value: sessionStore.value } : undefined) }),
  headers: () => new Headers(),
}));

const getUser = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabaseConfigured: vi.fn(() => true),
  getSupabase: () => ({ auth: { getUser: (...args: unknown[]) => getUser(...args) } }),
  isGoTrueAlreadyRegisteredError: () => false,
  isGoTrueServerError: () => false,
}));

const EMAIL = "grace-kid1175@example.test";

beforeEach(async () => {
  await seedFixture();
  getUser.mockReset();
});

async function unconfirmedAccount(email: string) {
  return await createAccount({
    email,
    password: "password-123",
    fullName: "Grace Kid1175",
    emailConfirmed: false,
  });
}

async function callConfirm(email: string, token: string) {
  const { confirmEmailAction } = await import("@/lib/actions");
  return await confirmEmailAction(email, token);
}

function goTrueUserFor(email: string) {
  return { data: { user: { email, id: `gt-${email}` } }, error: null };
}

describe("KID-1175/F-07 confirmEmailAction requires GoTrue proof", () => {
  it("a token verifying NOW to the same email flips the local flag", async () => {
    await unconfirmedAccount(EMAIL);
    getUser.mockReturnValue(goTrueUserFor(EMAIL));
    const result = await callConfirm(EMAIL, "valid-gotrue-access-token");
    expect(result).toEqual({ ok: true });
    expect(await findAccountByEmail(EMAIL)).toMatchObject({ email_confirmed: 1 });
    expect(getUser).toHaveBeenCalledWith("valid-gotrue-access-token");
  });

  it("a token GoTrue refuses changes nothing and answers uniformly", async () => {
    await unconfirmedAccount(EMAIL);
    getUser.mockReturnValue({ data: { user: null }, error: { message: "Invalid JWT" } });
    const result = await callConfirm(EMAIL, "forged-or-expired-token");
    expect(result).toEqual({ ok: true });
    expect(await findAccountByEmail(EMAIL)).toMatchObject({ email_confirmed: 0 });
  });

  it("a foreign token (verifies to a DIFFERENT email) changes nothing", async () => {
    await unconfirmedAccount(EMAIL);
    getUser.mockReturnValue(goTrueUserFor("attacker@elsewhere.test"));
    const result = await callConfirm(EMAIL, "someone-elses-confirmation-token");
    expect(result).toEqual({ ok: true });
    expect(await findAccountByEmail(EMAIL)).toMatchObject({ email_confirmed: 0 });
  });

  it("an empty or missing token is a safe no-op", async () => {
    await unconfirmedAccount(EMAIL);
    for (const token of ["", "   "]) {
      expect(await callConfirm(EMAIL, token)).toEqual({ ok: true });
    }
    expect(getUser).not.toHaveBeenCalled();
    expect(await findAccountByEmail(EMAIL)).toMatchObject({ email_confirmed: 0 });
  });

  it("a valid token for an unknown email holds state and never writes", async () => {
    getUser.mockReturnValue(goTrueUserFor("ghost-kid1175@example.test"));
    const result = await callConfirm("ghost-kid1175@example.test", "valid-gotrue-access-token");
    expect(result).toEqual({ ok: true });
    expect(await findAccountByEmail("ghost-kid1175@example.test")).toBeUndefined();
  });

  it("confirming twice is idempotent and a remote email change re-verifies", async () => {
    await unconfirmedAccount(EMAIL);
    getUser.mockReturnValue(goTrueUserFor(EMAIL));
    await callConfirm(EMAIL, "token-1");
    await callConfirm(EMAIL, "token-2");
    expect(await findAccountByEmail(EMAIL)).toMatchObject({ email_confirmed: 1 });

    // A token that verifies to a different address never re-flips anything.
    getUser.mockReturnValue(goTrueUserFor("attacker@elsewhere.test"));
    await callConfirm(EMAIL, "swapped-token");
    expect(await findAccountByEmail(EMAIL)).toMatchObject({ email_confirmed: 1 });
  });

  it("the whole unverified surface is uniform: mock down, misconfigured supabase included", async () => {
    await unconfirmedAccount(EMAIL);
    getUser.mockReturnValue(goTrueUserFor(EMAIL));
    const { supabaseConfigured } = (await import("@/lib/supabase")) as {
      supabaseConfigured: ReturnType<typeof vi.fn>;
    };
    supabaseConfigured.mockReturnValue(false);
    const result = await callConfirm(EMAIL, "valid-gotrue-access-token");
    expect(result).toEqual({ ok: true });
    expect(await findAccountByEmail(EMAIL)).toMatchObject({ email_confirmed: 0 });
  });
});
