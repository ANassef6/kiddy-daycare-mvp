// KID-500: completing activation through a valid pending invite leaves the
// account in a CONFIRMED state. The report (Sunshine, mayoda0@gmail.com) was
// an account the parent had fully activated — invite accepted, both children
// linked, login app-side-only (auth_user_id = null) because GoTrue had
// rate-limited the sign-up confirmation send ("email rate limit exceeded") —
// whose local mirror still said email_confirmed = 0. Nothing ever synced the
// flag afterward: no confirmation email existed to confirm, and the GoTrue
// login-time sync only runs for GoTrue-confirmed logins. Result: the admin
// portal kept rendering "Resend activation" for an account that could already
// sign in, and the parent kept seeing the /welcome confirm banner.
//
// Decision pinned here: the redeemed single-use invite code — issued to, and
// only redeemable by, exactly that address — IS the email-ownership proof. So
// on every successful invite-based activation path the mirror flips to
// email_confirmed = 1 and the minted session carries emailConfirmed: true:
//   1. registerAction's rate-limited sign-up path (the mayoda0 shape).
//   2. registerAction's app-side adoption path (KID-123, auth_user_id null).
//   3. The KID-498 login/app self-heal (healParentActivation), which consumes
//      the same kind of pending invite — with the post-gate login redirect
//      reading the LIVE row instead of the pre-heal snapshot.
//   4. The admin "Resend activation" affordance (lib/activation.ts) driven by
//      the same flag: hidden for activations, kept for GoTrue sign-ups that
//      never completed anything.
//   5. The 0035 SQLite mirror repair: the already-existing stuck rows flip
//      once; staff mirrors, all-withdrawn parents, and accounts with no
//      accepted invite stay untouched; replay is a no-op (idempotent + decoys).
//
// Deliberately NOT authorized: an invite issued to a different address proves
// nothing about this account's email — the flag (and the KID-126 resend)
// stay as computed on a mismatch, /welcome keeps its old meaning.

import { beforeEach, describe, expect, it, vi } from "vitest";

// ---- next/headers mock with a per-test cookie jar (kid499 pattern) ----------
const mockState = vi.hoisted(() => ({
  host: "" as string,
  setCalls: [] as { name: string; value: string }[],
}));
vi.mock("next/headers", () => ({
  headers: () => new Headers(mockState.host ? { host: mockState.host } : {}),
  cookies: () => ({
    get: () => undefined,
    set: (name: string, value: string) => {
      mockState.setCalls.push({ name, value });
    },
  }),
}));

// ---- GoTrue mock: signUp / signInWithPassword / resend answer per test ------
const goTrueState = vi.hoisted(() => ({
  signUp: (async () => ({ data: {}, error: null })) as (args: unknown) => Promise<{
    data: { user?: unknown; session?: unknown };
    error: unknown;
  }>,
  signInWithPassword: (async () => ({ data: { user: null }, error: null })) as (args: unknown) => Promise<{
    data: { user: unknown };
    error: unknown;
  }>,
  resend: (async () => ({ error: null })) as (args: unknown) => Promise<{ error: unknown }>,
}));
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    supabaseConfigured: () => true,
    getSupabase: () => ({
      auth: {
        signUp: goTrueState.signUp,
        signInWithPassword: goTrueState.signInWithPassword,
        resend: goTrueState.resend,
      },
    }),
  };
});

import { loginAction, registerAction } from "@/lib/actions";
import { createAccount } from "@/lib/auth";
import { ensureSchema, queryGet, queryRun } from "@/lib/db";
import * as store from "@/lib/store";
import { activationByEmails, isUnactivatedAccount } from "@/lib/activation";
import { seedFixture } from "../helpers";

let iid: string;
let roomId: string;

beforeEach(async () => {
  await seedFixture();
  iid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
  roomId = String((await queryGet("SELECT id FROM room WHERE name = 'Toddlers'"))!.id);
  mockState.host = "";
  mockState.setCalls = [];
  goTrueState.signUp = async () => ({ data: {}, error: null });
  goTrueState.signInWithPassword = async () => ({ data: { user: null }, error: null });
  goTrueState.resend = async () => ({ error: null });
});

async function invite(opts: {
  childId: string;
  email: string;
  code?: string;
  deposited?: string;
}): Promise<string> {
  const row = await store.createInvite(
    iid,
    opts.childId,
    // Lowercase utilities live in the invite pipeline; createInvite stores
    // what it is given, exactly like a real admin-typed row.
    opts.deposited ?? opts.email.toLowerCase(),
    opts.code ?? `K5-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    "parent"
  );
  return String(row.id);
}

function mintedPayload(): Record<string, unknown> | null {
  const minted = mockState.setCalls[mockState.setCalls.length - 1];
  if (!minted) return null;
  const [body] = minted.value.split(".");
  return JSON.parse(Buffer.from(body, "base64url").toString()) as Record<string, unknown>;
}

async function accountRow(email: string): Promise<Record<string, unknown>> {
  const row = await queryGet("SELECT * FROM account WHERE email = ?", email);
  if (!row) throw new Error(`no account for ${email}`);
  return row as unknown as Record<string, unknown>;
}

async function registerForm(email: string, inviteCode: string): Promise<FormData> {
  const form = new FormData();
  form.set("email", email);
  form.set("password", "correct-horse");
  form.set("fullName", "Kid 500 Parent");
  form.set("inviteCode", inviteCode);
  return form;
}

// ---- 1. registerAction: the rate-limited sign-up + invite shape -------------
describe("KID-500 registerAction: invite activation confirms the email mirror", () => {
  it("the real rate-limited activation: flag 1, confirmed cookie, redirect /child", async () => {
    goTrueState.signUp = async () => ({
      data: {},
      error: { code: "over_email_send_rate_limit", message: "Email rate limit exceeded" },
    });

    const child = await store.createChild({ instituteId: iid, firstName: "Mayo", lastName: "Refaat", roomId });
    const email = "kid500-activates@example.com";
    const code = `K5-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    await invite({ childId: String(child.id), email, code });

    // registerAction ends in redirect(), which throws inside the action; the
    // flag flip and the minted cookie both happen before it.
    await expect(registerAction(await registerForm(email, code))).rejects.toMatchObject({
      digest: expect.stringContaining("/child"),
    });

    expect(Number((await accountRow(email)).email_confirmed)).toBe(1);
    const minted = mintedPayload();
    expect(minted).toBeTruthy();
    expect(minted!.email).toBe(email);
    expect(minted!.emailConfirmed).toBe(true);
    expect(await store.parentAccountAccessState(String(minted!.accountId))).toBe("active");
  });

  it("app-side adoption (auth_user_id null): the flag flips all the same", async () => {
    // KID-123 shape: the GoTrue user exists with no app account, the parent
    // chooses a DIFFERENT password than the admin-invite one, so the password
    // sign-in fails and activation continues authenticated by the invite
    // alone — no GoTrue identity, no confirmation email, mirror stuck at 0
    // before this change.
    goTrueState.signUp = async () => ({
      data: {},
      error: { code: "user_already_exists", message: "User already registered" },
    });
    goTrueState.signInWithPassword = async () => ({
      data: { user: null },
      error: { code: "invalid_credentials", message: "Invalid login credentials" },
    });

    const child = await store.createChild({ instituteId: iid, firstName: "Adopted", lastName: "Refaat", roomId });
    const email = "kid500-appside@example.com";
    const code = `K5-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    await invite({ childId: String(child.id), email, code });

    await expect(registerAction(await registerForm(email, code))).rejects.toMatchObject({
      digest: expect.stringContaining("/child"),
    });

    const row = await accountRow(email);
    expect(Number(row.email_confirmed)).toBe(1);
    expect(row.auth_user_id ?? null).toBeNull();
    expect(mintedPayload()!.emailConfirmed).toBe(true);
  });

  it("an invite addressed to a DIFFERENT email is not ownership proof and stays unconfirmed", async () => {
    goTrueState.signUp = async () => ({
      data: {},
      error: { code: "over_email_send_rate_limit", message: "Email rate limit exceeded" },
    });

    const child = await store.createChild({ instituteId: iid, firstName: "Alternate", lastName: "Refaat", roomId });
    const email = "kid500-mismatch@example.com";
    const code = `K5-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    // The invite was issued to a different address: redeeming it links the
    // child but proves nothing about THIS mailbox's ownership.
    await invite({ childId: String(child.id), email, code, deposited: "kid500-mismatch-alt@example.com" });

    await expect(registerAction(await registerForm(email, code))).rejects.toMatchObject({
      digest: expect.stringContaining("/welcome"),
    });

    expect(Number((await accountRow(email)).email_confirmed)).toBe(0);
    expect(mintedPayload()!.emailConfirmed).toBe(false);
  });

  it("genuine activation failure (consumed invite) leaves the account as it was: no flag flip", async () => {
    // An already-used code never reaches the flip: registerAction returns an
    // error before any activation step runs.
    const child = await store.createChild({ instituteId: iid, firstName: "Spent", lastName: "Refaat", roomId });
    const email = "kid500-used-code@example.com";
    const code = `K5-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const inviteId = await invite({ childId: String(child.id), email, code, deposited: email });
    await queryRun("UPDATE invite SET status = 'accepted', email = ? WHERE id = ?", email, inviteId);

    await expect(registerAction(await registerForm(email, code))).resolves.toMatchObject({
      error: expect.stringContaining("already been used"),
    });
    expect(await queryGet("SELECT id FROM account WHERE email = ?", email)).toBeFalsy();
  });
});

// ---- 2. the login-time self-heal (KID-498 machinery) ------------------------
describe("KID-500 loginAction app-side self-heal: activation at login confirms the mirror", () => {
  it("a completed heal flips the flag, mints a confirmed session, and lands on /child", async () => {
    // Zero links + pending invite + app-side only password: exactly the login
    // the rate-limited registered parent experiences later.
    const child = await store.createChild({ instituteId: iid, firstName: "Healed", lastName: "Refaat", roomId });
    const email = "kid500-heal@example.com";
    await createAccount({
      email,
      password: "correct-horse",
      fullName: "Kid 500 Heal Parent",
      role: "parent",
      emailConfirmed: false,
    });
    await invite({ childId: String(child.id), email });
    mockState.setCalls = [];

    const form = new FormData();
    form.set("email", email);
    form.set("password", "correct-horse");

    // loginAction ends in redirect(); the minted cookie is already set.
    await expect(loginAction(form)).rejects.toMatchObject({
      digest: expect.stringContaining("/child"),
    });

    expect(Number((await accountRow(email)).email_confirmed)).toBe(1);
    const minted = mintedPayload();
    expect(minted!.email).toBe(email);
    expect(minted!.emailConfirmed).toBe(true);
    expect(await store.parentAccountAccessState(String(minted!.accountId))).toBe("active");
  });
});

// ---- 3. the admin "Resend activation" affordance reads the same flag --------
describe("KID-500 the admin resend affordance agrees with the activation state", () => {
  it("hides after an invite activation; still shows for a genuine GoTrue sign-up", async () => {
    const activated = await store.createChild({ instituteId: iid, firstName: "Shown Hide", lastName: "Refaat", roomId });
    const activatedEmail = "kid500-admin-hidden@example.com";
    await createAccount({
      email: activatedEmail,
      password: "x",
      fullName: "Kid 500 Activated",
      role: "parent",
      emailConfirmed: false,
    });
    const childId = String(activated.id);
    const activatedParentId = String((await accountRow(activatedEmail)).id);
    await store.linkFamily(activatedParentId, childId, "parent");
    const code = `K5-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const inviteId = await invite({ childId, email: activatedEmail, code });
    await queryRun("UPDATE invite SET status = 'accepted' WHERE id = ?", inviteId);
    // The same flip the runtime paths above perform (they are covered in the
    // suites above; here the flag is set the way the repair + runtime land).
    await queryRun("UPDATE account SET email_confirmed = 1 WHERE id = ?", activatedParentId);

    const activation = await activationByEmails([activatedEmail]);
    expect(activation.get(activatedEmail)!.unactivated).toBe(false);

    // A GoTrue sign-up that never completed activation: no accepted invite,
    // mirror still 0 — the affordance stays.
    const pendingEmail = "kid500-admin-visible@example.com";
    await createAccount({
      email: pendingEmail,
      password: "x",
      fullName: "Kid 500 Pending",
      role: "parent",
      emailConfirmed: false,
    });
    const pending = await activationByEmails([pendingEmail]);
    expect(pending.get(pendingEmail)!.unactivated).toBe(true);
    expect(
      isUnactivatedAccount(await queryGet("SELECT email_confirmed FROM account WHERE email = ?", pendingEmail))
    ).toBe(true);
  });
});

// ---- 4. the 0035 SQLite mirror: the one-time repair -------------------------
describe("KID-500 the 0035 mirror (lib/sqlite-schema.ts): the one-time repair", () => {
  it("confirms existing invite-activated mirrors, scoped exactly like the plan", async () => {
    // The mayoda0 shape: unconfirmed mirror, live family link, ACCEPTED
    // invite to the exact address (stored mixed-case like a real row).
    const stuckEmail = "kid500-mirror-stuck@example.com";
    const stuckChild = await store.createChild({ instituteId: iid, firstName: "Mirror", lastName: "Refaat", roomId });
    await createAccount({
      email: stuckEmail,
      password: "x",
      fullName: "Kid 500 Stuck",
      role: "parent",
      emailConfirmed: false,
    });
    const stuckId = String((await accountRow(stuckEmail)).id);
    await store.linkFamily(stuckId, String(stuckChild.id), "parent");
    const stuckInvite = await invite({ childId: String(stuckChild.id), email: stuckEmail });
    await queryRun("UPDATE invite SET status = 'accepted', email = ? WHERE id = ?", stuckEmail, stuckInvite);

    // A live-invite account that was never activated at all (KID-498 oracle):
    // pending invite, zero links, flag 0.
    const orphanEmail = "kid500-mirror-orphan@example.com";
    const orphanChild = await store.createChild({ instituteId: iid, firstName: "Orphan", lastName: "Refaat", roomId });
    await createAccount({
      email: orphanEmail,
      password: "x",
      fullName: "Kid 500 Orphan",
      role: "parent",
      emailConfirmed: false,
    });
    const orphanId = String((await accountRow(orphanEmail)).id);
    await queryRun("UPDATE account SET staff_id = 'st-detached' WHERE id = ?", orphanId);
    await invite({ childId: String(orphanChild.id), email: orphanEmail });

    // A parent whose only child withdrew (a genuine end), unconfirmed + accepted invite.
    const goneEmail = "kid500-mirror-gone@example.com";
    const goneChild = await store.createChild({ instituteId: iid, firstName: "Gone", lastName: "Refaat", roomId });
    await queryRun("UPDATE child SET status = 'withdrawn', active = 0 WHERE id = ?", String(goneChild.id));
    await createAccount({
      email: goneEmail,
      password: "x",
      fullName: "Kid 500 Gone",
      role: "parent",
      emailConfirmed: false,
    });
    const goneId = String((await accountRow(goneEmail)).id);
    await store.linkFamily(goneId, String(goneChild.id), "parent");
    const goneInvite = await invite({ childId: String(goneChild.id), email: goneEmail });
    await queryRun("UPDATE invite SET status = 'accepted' WHERE id = ?", goneInvite);

    // A live-linked, unconfirmed parent with NO invite at all — the affordance
    // must keep rendering for this one. (An account linked ONLY to its
    // pending invite's child is the 0034 ACT-INVITE failure shape — that
    // mirror legitimately consumes the invite on the re-run, so a pending
    // invite alone is not safe as a "no accepted invite" decoy here.)
    const noinviteEmail = "kid500-mirror-noinvite@example.com";
    const noinviteChild = await store.createChild({ instituteId: iid, firstName: "NoInvite", lastName: "Refaat", roomId });
    await createAccount({
      email: noinviteEmail,
      password: "x",
      fullName: "Kid 500 NoInvite",
      role: "parent",
      emailConfirmed: false,
    });
    const noinviteId = String((await accountRow(noinviteEmail)).id);
    await store.linkFamily(noinviteId, String(noinviteChild.id), "parent");

    // An unconfirmed mirror whose accepted invite was for a different address.
    const otherEmail = "kid500-mirror-other@example.com";
    const otherChild = await store.createChild({ instituteId: iid, firstName: "Other", lastName: "Refaat", roomId });
    await createAccount({
      email: otherEmail,
      password: "x",
      fullName: "Kid 500 Other",
      role: "parent",
      emailConfirmed: false,
    });
    const otherId = String((await accountRow(otherEmail)).id);
    await store.linkFamily(otherId, String(otherChild.id), "parent");
    const otherInvite = await invite({ childId: String(otherChild.id), email: otherEmail });
    await queryRun("UPDATE invite SET status = 'accepted', email = ? WHERE id = ?", "kid500-someone-else@example.com", otherInvite);

    await ensureSchema();

    expect(Number((await accountRow(stuckEmail)).email_confirmed)).toBe(1);
    expect(Number((await accountRow(orphanEmail)).email_confirmed)).toBe(0);
    expect(Number((await accountRow(goneEmail)).email_confirmed)).toBe(0);
    expect(Number((await accountRow(noinviteEmail)).email_confirmed)).toBe(0);
    expect(Number((await accountRow(otherEmail)).email_confirmed)).toBe(0);
  });

  it("already-confirmed mirrors and staff accounts stay exactly as they are", async () => {
    const confirmedEmail = "kid500-mirror-confirmed@example.com";
    const child = await store.createChild({ instituteId: iid, firstName: "Confirmed", lastName: "Refaat", roomId });
    await createAccount({
      email: confirmedEmail,
      password: "x",
      fullName: "Kid 500 Confirmed",
      role: "parent",
      emailConfirmed: true,
    });
    const id = String((await accountRow(confirmedEmail)).id);
    await store.linkFamily(id, String(child.id), "parent");
    const inviteId = await invite({ childId: String(child.id), email: confirmedEmail });
    await queryRun("UPDATE invite SET status = 'accepted' WHERE id = ?", inviteId);

    const staffEmail = "kid500-mirror-staff@example.com";
    await createAccount({
      email: staffEmail,
      password: "x",
      fullName: "Kid 500 Staff Mirror",
      role: "teacher",
      emailConfirmed: false,
    });
    await queryRun("UPDATE account SET staff_id = 'st-fake-mirror' WHERE email = ?", staffEmail);

    await ensureSchema();

    expect(Number((await accountRow(confirmedEmail)).email_confirmed)).toBe(1);
    expect(Number((await accountRow(staffEmail)).email_confirmed)).toBe(0);
  });

  it("is idempotent: replaying the repair flips nothing and fresh candidates heal", async () => {
    const stuckEmail = "kid500-mirror-idem@example.com";
    const child = await store.createChild({ instituteId: iid, firstName: "Idem", lastName: "Refaat", roomId });
    await createAccount({
      email: stuckEmail,
      password: "x",
      fullName: "Kid 500 Idem",
      role: "parent",
      emailConfirmed: false,
    });
    const id = String((await accountRow(stuckEmail)).id);
    await store.linkFamily(id, String(child.id), "parent");
    const inviteId = await invite({ childId: String(child.id), email: stuckEmail });
    await queryRun("UPDATE invite SET status = 'accepted' WHERE id = ?", inviteId);

    await ensureSchema();
    expect(Number((await accountRow(stuckEmail)).email_confirmed)).toBe(1);
    const confirmedFlag = Number((await accountRow(stuckEmail)).email_confirmed);

    // Replay: still 1, and nothing flips back to 0, nothing else is touched.
    await ensureSchema();
    await ensureSchema();
    expect(Number((await accountRow(stuckEmail)).email_confirmed)).toBe(confirmedFlag);

    // A NEW incident-shaped row added after the first pass heals next pass.
    const lateEmail = "kid500-mirror-late@example.com";
    const lateChild = await store.createChild({ instituteId: iid, firstName: "Late", lastName: "Refaat", roomId });
    await createAccount({
      email: lateEmail,
      password: "x",
      fullName: "Kid 500 Late",
      role: "parent",
      emailConfirmed: false,
    });
    const lateId = String((await accountRow(lateEmail)).id);
    await store.linkFamily(lateId, String(lateChild.id), "parent");
    const lateInvite = await invite({ childId: String(lateChild.id), email: lateEmail });
    await queryRun("UPDATE invite SET status = 'accepted' WHERE id = ?", lateInvite);

    await ensureSchema();
    expect(Number((await accountRow(lateEmail)).email_confirmed)).toBe(1);
  });
});
