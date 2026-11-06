// KID-499: the parent "email isn't confirmed" banner had to clear as soon as
// the email is verified, in the SAME browser session, with no sign-out or
// sign-in. The live report (Sunshine, yarahisham032@) was a signed-in parent
// whose cookie snapshot said emailConfirmed: false even though GoTrue had
// confirmed the address and the local row was repaired — the banner was
// rendered straight off the stale snapshot.
//
// Pinned here:
//   1. confirmEmailAction re-mints the visitor's own matching session cookie
//      (server actions may write cookies), so a signed-in parent who clicks a
//      valid confirmation link lands with a fresh emailConfirmed: true
//      cookie. The re-mint is authorized by an existing, matching cookie —
//      the confirm link proves email control, but a brand-new session is
//      never conjured for an anonymous visitor.
//   2. The layouts render the banner from the LIVE account row whenever the
//      snapshot says unconfirmed (lib/auth.ts emailConfirmedDisplayFor), so
//      an out-of-band confirmation/repair can never contradict the provider
//      state; a DB failure keeps the snapshot (fail-open, pre-KID-499
//      behaviour).
//   3. The GoTrue login-time sync stays: GoTrue-confirmed + local flag 0 +
//      successful password sign-in sets the local flag and the minted
//      session carries emailConfirmed: true.

import { beforeEach, describe, expect, it, vi } from "vitest";

// ---- next/headers mock with a per-test cookie jar (kid264 pattern) ----------
const mockState = vi.hoisted(() => ({
  host: "" as string,
  cookieValue: "" as string,
  setCalls: [] as { name: string; value: string }[],
}));
vi.mock("next/headers", () => ({
  headers: () => new Headers(mockState.host ? { host: mockState.host } : {}),
  cookies: () => ({
    get: (name: string) =>
      name === "kiddy_sess" && mockState.cookieValue ? { name, value: mockState.cookieValue } : undefined,
    set: (name: string, value: string) => {
      mockState.setCalls.push({ name, value });
      mockState.cookieValue = value;
    },
  }),
}));

// ---- GoTrue mock: signInWithPassword answers per-test ----------------------
const goTrueState = vi.hoisted(() => ({
  signIn:
    // shape: { data: { user }, error } exactly like supabase-js v2
    (async () => ({ data: { user: null }, error: null })) as (args: unknown) => Promise<{
      data: { user: unknown };
      error: unknown;
    }>,
}));
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    supabaseConfigured: () => true,
    getSupabase: () => ({ auth: { signInWithPassword: goTrueState.signIn } }),
  };
});

import { confirmEmailAction, loginAction } from "@/lib/actions";
import { createSessionToken, createAccount, emailConfirmedDisplayFor, type Session } from "@/lib/auth";
import { linkFamily, seedInstitute, createRoom, createChild } from "@/lib/store";
import { queryGet, queryRun } from "@/lib/db";
import { seedFixture } from "../helpers";

function sessionCookieFor(session: Omit<Session, "operatorViewInstituteId">): string {
  return createSessionToken(session);
}

function setJarTo(
  account: { id: string; email: string; role: string },
  emailConfirmed: boolean
): void {
  mockState.cookieValue = sessionCookieFor({
    accountId: String(account.id),
    role: String(account.role),
    email: String(account.email),
    emailConfirmed,
  });
  mockState.setCalls = [];
}

function mintedPayload(): Record<string, unknown> | null {
  const minted = mockState.setCalls[mockState.setCalls.length - 1];
  if (!minted) return null;
  const [body] = minted.value.split(".");
  return JSON.parse(Buffer.from(body, "base64url").toString()) as Record<string, unknown>;
}

async function parentIdFor(email: string): Promise<string> {
  const row = await queryGet("SELECT id FROM account WHERE email = ?", email);
  if (!row) throw new Error(`no account for ${email}`);
  return String(row.id);
}

beforeEach(async () => {
  await seedFixture();
  mockState.host = "";
  mockState.cookieValue = "";
  mockState.setCalls = [];
  goTrueState.signIn = async () => ({ data: { user: null }, error: null });
});

// ---- 1. same-session clear through /auth/confirm -----------------------------
describe("KID-499 confirmEmailAction same-session cookie refresh", () => {
  it("re-mints the visitor's matching stale cookie with emailConfirmed: true", async () => {
    const email = "kid499-confirm@example.com";
    const account = await createAccount({
      email,
      password: "correct-horse",
      fullName: "Kid 499 Parent",
      role: "parent",
      emailConfirmed: false,
    });
    setJarTo({ id: String(account.id), email: account.email, role: "parent" }, false);

    await confirmEmailAction(email);

    const minted = mintedPayload();
    expect(minted).toBeTruthy();
    expect(minted!.email).toBe(email);
    expect(minted!.emailConfirmed).toBe(true);
    const row = await queryGet("SELECT email_confirmed FROM account WHERE id = ?", String(account.id));
    expect(Number(row!.email_confirmed)).toBe(1);
  });

  it("minted cookie verifes as a valid session for the same account", async () => {
    const email = "kid499-confirm2@example.com";
    const account = await createAccount({
      email,
      password: "correct-horse",
      fullName: "Kid 499 Parent Two",
      role: "parent",
      emailConfirmed: false,
    });
    setJarTo({ id: String(account.id), email: account.email, role: "parent" }, false);
    await confirmEmailAction(email);
    // The re-minted value must still be the signed kiddy_sess cookie shape.
    expect(mockState.setCalls[0].name).toBe("kiddy_sess");
    expect(mintedPayload()!.accountId).toBe(String(account.id));
  });

  it("does NOT conjure a session for an anonymous confirm (no matching cookie)", async () => {
    const email = "kid499-anon@example.com";
    await createAccount({
      email,
      password: "correct-horse",
      fullName: "Kid 499 Anonymous",
      role: "parent",
      emailConfirmed: false,
    });
    mockState.cookieValue = ""; // no session held
    await confirmEmailAction(email);
    expect(mockState.setCalls).toHaveLength(0);
    const row = await queryGet("SELECT email_confirmed FROM account WHERE email = ?", email);
    expect(Number(row!.email_confirmed)).toBe(1); // flag still flips
  });

  it("leaves a SESSION FOR A DIFFERENT EMAIL untouched", async () => {
    const email = "kid499-mismatch-confirm@example.com";
    await createAccount({
      email,
      password: "correct-horse",
      fullName: "Kid 499 Mismatch",
      role: "parent",
      emailConfirmed: false,
    });
    const other = await createAccount({
      email: "kid499-other@example.com",
      password: "correct-horse",
      fullName: "Kid 499 Other Holder",
      role: "parent",
      emailConfirmed: false,
    });
    setJarTo({ id: String(other.id), email: other.email, role: "parent" }, false);
    await confirmEmailAction(email);
    // The held cookie is the holder's ORIGINAL snapshot, never re-minted.
    const stillHeld = JSON.parse(
      Buffer.from(mockState.cookieValue.split(".")[0], "base64url").toString()
    ) as Record<string, unknown>;
    expect(stillHeld.email).toBe("kid499-other@example.com");
    expect(stillHeld.emailConfirmed).toBe(false);
    expect(Number((await queryGet("SELECT email_confirmed FROM account WHERE email = ?", email))!.email_confirmed)).toBe(1);
  });
});

// ---- 2. the banner renders from the live row --------------------------------
describe("KID-499 emailConfirmedDisplayFor (banner decision)", () => {
  it("hides the banner when the row is confirmed despite the stale cookie", async () => {
    const account = await createAccount({
      email: "kid499-stale@example.com",
      password: "x",
      fullName: "Kid 499 Stale",
      role: "parent",
      emailConfirmed: false,
    });
    const session: Session = {
      accountId: String(account.id),
      role: "parent",
      email: account.email,
      emailConfirmed: false, // stale snapshot
    };
    await queryRun("UPDATE account SET email_confirmed = 1 WHERE id = ?", String(account.id));
    expect(await emailConfirmedDisplayFor(session)).toBe(true);
  });

  it("still shows the banner for a genuinely unconfirmed account", async () => {
    const account = await createAccount({
      email: "kid499-unconfirmed@example.com",
      password: "x",
      fullName: "Kid 499 Unconfirmed",
      role: "parent",
      emailConfirmed: false,
    });
    expect(
      await emailConfirmedDisplayFor({
        accountId: String(account.id),
        role: "parent",
        email: account.email,
        emailConfirmed: false,
      })
    ).toBe(false);
  });

  it("snapshot-confirmed sessions never touch the DB (fast path stays true)", async () => {
    expect(
      await emailConfirmedDisplayFor({
        accountId: "no-such-account",
        role: "parent",
        email: "ghost@example.com",
        emailConfirmed: true,
      })
    ).toBe(true);
  });
});

// ---- 3. the GoTrue login-time sync regression -------------------------------
describe("KID-499 login syncs a GoTrue-confirmed email into the local flag + cookie", () => {
  it("GoTrue-confirmed login with local flag 0 sets the flag and mints emailConfirmed: true", async () => {
    // A parent whose invite already completed (family link exists) but whose
    // local mirror still says unconfirmed.
    const inst = await seedInstitute({ name: "Kid 499 Center" });
    const room = await createRoom(String(inst.id), "Kid 499 Room", 10);
    const child = await createChild({
      instituteId: String(inst.id),
      firstName: "Zein",
      lastName: "K499",
      roomId: String(room.id),
    });
    await createAccount({
      email: "kid499-login@example.com",
      password: "correct-horse",
      fullName: "Kid 499 Login Parent",
      role: "parent",
      emailConfirmed: false,
    });
    const accountId = await parentIdFor("kid499-login@example.com");
    await linkFamily(accountId, String(child.id), "parent");

    goTrueState.signIn = async () => ({
      data: {
        user: { email: "kid499-login@example.com", email_confirmed_at: "2026-11-06T21:43:45.099057Z" },
      },
      error: null,
    });
    mockState.setCalls = [];

    const form = new FormData();
    form.set("email", "kid499-login@example.com");
    form.set("password", "correct-horse");

    // loginAction ends in redirect(), which throws inside the action; the
    // session cookie is already minted by then, which is what we assert.
    await expect(loginAction(form)).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });

    expect(Number((await queryGet("SELECT email_confirmed FROM account WHERE id = ?", accountId))!.email_confirmed)).toBe(1);
    const minted = mintedPayload();
    expect(minted).toBeTruthy();
    expect(minted!.email).toBe("kid499-login@example.com");
    expect(minted!.emailConfirmed).toBe(true);
  });
});
