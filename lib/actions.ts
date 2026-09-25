"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { LANG_COOKIE } from "@/lib/i18n";
import {
  createAccount,
  findAccountByEmail,
  verifyPassword,
  createSessionToken,
  setPin,
  verifyToken,
  setEmailConfirmed,
  emailConfirmedFor,
  staffIdForAccount,
} from "@/lib/auth";
import { queryGet, queryRun, queryAll, ensureSchema, isForeignKeyViolation } from "@/lib/db";
import {
  isAccountAccessWithdrawn,
  runWithdrawalSweep,
  isChildInScope,
  scopedRoomIds,
} from "@/lib/store";
import {
  getInviteByCode,
  linkFamily,
  checkChildInOut,
  upsertDailyReport,
  createNewsfeedPost,
  addComment,
  createConsent,
  respondConsent,
  createIncident,
  acknowledgeIncident,
  createChild,
  createStaff,
  createRoom,
  updateRoom,
  addContact,
  logChildStatus,
  createInvite,
  updateInstitute,
  createContactRequest,
  createEvent,
  addEventMedia,
  createForm,
  saveFormResponse,
  createTag,
  setChildTags,
  addDriveFile,
  createObservation,
  createSupportTicket,
  setTicketStatus,
  sendMessage,
  markRead,
  createChildBilling,
  updateChildBilling,
  updateChildPhoto,
  updateStaffPhoto,
  toggleLike,
  saveWorkingHours,
  checkInAllowed,
  runAutoCheckoutSweep,
} from "@/lib/store";
import type { WorkingWeek } from "@/lib/working-hours";
import { supabaseConfigured, getSupabase, isGoTrueAlreadyRegisteredError, isGoTrueServerError } from "@/lib/supabase";
import { activationStepError } from "@/lib/activation";
import { requestOrigin, publicOrigin } from "@/lib/url";
import { isAdminRole } from "@/lib/role";
import {
  buildParentInviteEmail,
  getInviteById,
  getPendingInvitesByEmail,
  isValidInviteCode,
  isValidInviteEmail,
  sendParentInviteEmail,
} from "@/lib/invite-email";

const SESSION_COOKIE = "kiddy_sess";

type SessionCookie = {
  accountId: string;
  role: string;
  email: string;
  emailConfirmed: boolean;
};

async function setSession(email: string) {
  const account = await findAccountByEmail(email);
  if (!account) throw new Error("account not found");
  const confirmed = emailConfirmedFor(account);
  const token = createSessionToken({
    accountId: account.id,
    role: account.role,
    email: account.email,
    emailConfirmed: confirmed,
  });
  cookies().set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 24 * 3600,
  });
  return account;
}

function homeForRole(role: string): string {
  return role === "parent" ? "/child" : "/portal/dashboard";
}

export async function loginAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  // Primary path: Supabase Auth (GoTrue) when the project is wired. An
  // unconfirmed email makes GoTrue reject the password (email_not_confirmed),
  // so we fall through to the app-side verify below — that keeps the session
  // usable while we show the "confirm your email" state.
  if (supabaseConfigured()) {
    const { data, error } = await getSupabase().auth.signInWithPassword({ email, password });
    if (!error && data.user) {
      const account = await findAccountByEmail(email);
      if (account) {
        if (data.user.email_confirmed_at && !emailConfirmedFor(account)) {
          await setEmailConfirmed(account.id, true);
        }
        await setSession(account.email);
        redirect(homeForRole(account.role));
      }
    }
  }

  // Fallback: app-side verify (seeded demo accounts, or Supabase users whose
  // password was stored locally too).
  const account = await findAccountByEmail(email);
  if (!account || !verifyPassword(password, account.password_hash)) {
    return { error: "Invalid email or password." };
  }
  // KID-86 item 9: apply any reached last-dates before letting the session in.
  try {
    await runWithdrawalSweep();
  } catch (err) {
    console.error("Login withdrawal sweep failed:", err);
  }
  if (await isAccountAccessWithdrawn(account.id)) {
    return { error: "This account's access has been withdrawn." };
  }
  // KID-112: contacts with relationship "No access" cannot log in
  // (e.g. unpaid fees). The admin re-enables them by changing the role.
  if (account.role === "parent") {
    const { familyAccessForAccount } = await import("@/lib/store");
    const access = await familyAccessForAccount(account.id);
    if (access === "no_access") {
      return { error: "This account's access is currently disabled. Contact your daycare admin." };
    }
  }
  await setSession(account.email);
  redirect(emailConfirmedFor(account) ? homeForRole(account.role) : "/welcome");
}

export async function registerAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("fullName") ?? "").trim();
  const inviteCode = String(formData.get("inviteCode") ?? "").trim();

  // Parents cannot create accounts on their own — the daycare invites them.
  // A valid, still-pending invite code is required to activate an account.
  if (!inviteCode) {
    return { error: "Your daycare must invite you first. Ask them for an invite code." };
  }
  // KID-121: the invite lookup touches the database, which can be unreachable
  // (missing/unreachable Postgres, read-only SQLite fallback on serverless).
  // A lookup failure must render a friendly message, never a 500 digest page.
  let invite;
  try {
    invite = await getInviteByCode(inviteCode);
  } catch (err) {
    console.error(
      `KID-121 register: invite lookup failed for code ${inviteCode}:`,
      err instanceof Error ? err.message : err
    );
    return {
      error:
        "We couldn't verify that invite code right now. Try again in a moment, or ask your daycare for a new one.",
    };
  }
  if (!invite) {
    return { error: "That invite code wasn't found. Check the code your daycare sent you." };
  }
  if (String(invite.status ?? "pending") !== "pending") {
    return { error: "That invite code has already been used. Ask your daycare for a new one." };
  }

  // KID-121: every DB access below can throw when the database is unreachable.
  // Fail with a friendly message (logged) instead of a 500 digest page. The
  // setSession/redirect tail stays outside so NEXT_REDIRECT still propagates.
  // KID-123: `step` names the exact call in the catch log so the next failure
  // is diagnosable to file:line from the runtime logs alone.
  let account: Awaited<ReturnType<typeof createAccount>> | null = null;
  let emailConfirmed = true;
  let step = "findAccount";
  try {
    if (await findAccountByEmail(email)) {
      return { error: "An account with that email already exists." };
    }

    // Create a real GoTrue user for every self-service registration, then record
    // whether the email still needs confirmation. GoTrue on this demo project has
    // email confirmation enabled and rate-limits confirmation sends, so signup
    // often returns over_email_send_rate_limit. That is NOT fatal: the app-side
    // account + session keep the MVP usable, and the /welcome page shows the
    // confirmation state. blindSignup notes whether we still need to confirm.
    let authUserId: string | null = null;
    if (supabaseConfigured()) {
      step = "goTrueSignUp";
      const { data, error } = await getSupabase().auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${publicOrigin(requestOrigin())}/auth/confirm` },
      });
      const isRateLimited = !!(
        error &&
        (error.code === "over_email_send_rate_limit" ||
          String(error.message).toLowerCase().includes("rate limit"))
      );
      if (error) {
        if (isRateLimited) {
          // Rate-limited confirmation send: keep the app session usable anyway.
          console.warn(`KID-111 register: GoTrue confirm email rate-limited for ${email}; app session continues unconfirmed.`);
          emailConfirmed = false;
        } else if (isGoTrueAlreadyRegisteredError(error)) {
          // KID-123: the GoTrue user exists but the app account does not
          // (e.g. created by the 11:49 admin invite for KID-P5YM5T, or an
          // earlier attempt that died after signUp). Without this branch the
          // parent can never activate: signUp keeps returning "already
          // registered" while no app account exists to sign in with. The
          // submitted password proves ownership: a successful sign-in adopts
          // the existing GoTrue user and activation continues below.
          step = "goTrueAdoptSignIn";
          const { data: signInData, error: signInError } = await getSupabase().auth.signInWithPassword({
            email,
            password,
          });
          if (signInError || !signInData.user) {
            // KID-123 fallback: the GoTrue user was created without the parent
            // choosing a password (admin invite email). The submitted password
            // cannot prove ownership, so fall back to the invite itself: when
            // the pending invite was issued to exactly this email, the
            // single-use code authorizes the claim. Activation continues with
            // an app-side password (authUserId stays null); GoTrue is untouched
            // until the parent uses password reset, and login falls through to
            // the app-side verify. The invite is consumed below, so this cannot
            // be replayed. On email mismatch, direct to sign-in instead.
            const inviteEmail = String(invite.email ?? "").trim().toLowerCase();
            if (inviteEmail && inviteEmail === email.toLowerCase()) {
              console.warn(`KID-123 register: password sign-in failed for existing GoTrue user ${email}; continuing with app-side account (invite ${inviteCode} authorizes the claim).`);
              authUserId = null;
            } else {
              console.warn(`KID-123 register: GoTrue user exists for ${email} but password sign-in failed; directing to sign-in.`);
              return {
                error:
                  "An account with this email already exists. Try signing in instead, or reset your password.",
              };
            }
          } else {
            authUserId = signInData.user.id;
            emailConfirmed = !!(
              signInData.session ||
              signInData.user.email_confirmed_at ||
              (signInData.user as unknown as Record<string, unknown>).confirmed_at
            );
            console.log(`KID-123 register: adopted existing GoTrue user for ${email}; activation continues.`);
          }
        } else if (isGoTrueServerError(error)) {
          // KID-124: the sign-in service itself failed (HTTP 5xx / transport).
          // This is NOT a wrong password and NOT a validation problem — say
          // so explicitly and keep the raw exception in the server log only.
          console.error(`KID-124 register: GoTrue signUp server error for ${email}:`, error.code ?? "", error.message);
          return { error: activationStepError("goTrueSignUp") };
        } else {
          // KID-111: log GoTrue signup failures so missing confirm emails are diagnosable.
          console.error(`KID-111 register: GoTrue signUp failed for ${email}:`, error.code ?? "", error.message);
          return { error: error.message };
        }
      } else {
        authUserId = data.user?.id ?? null;
        // On a confirmation-gated project GoTrue only issues a session (and only
        // sets confirmed_at) once the email is verified. right after signup
        // identities is already non-empty, so it is NOT a confirmation signal.
        emailConfirmed = !!(data.session || data.user?.email_confirmed_at || data.user?.confirmed_at);
      }
    }

    step = "createAccount";
    try {
      account = await createAccount({
        email,
        password,
        fullName,
        role: "parent",
        authUserId,
        emailConfirmed,
      });
    } catch (err) {
      // KID-125: the adopted GoTrue id can violate the
      // account_auth_user_id_fkey (the auth.users row is missing/unreadable
      // on the live project) even though sign-in succeeded. The pending
      // invite already authorized this claim, so retry app-side without the
      // GoTrue link — login falls through to the app-side password verify
      // and the parent is no longer stuck. Any other error (or a second
      // failure) still throws to the ACT-ACCOUNT message below.
      if (authUserId && isForeignKeyViolation(err)) {
        console.warn(
          `KID-125 register: auth_user_id FK violation for ${email}; retrying app-side without GoTrue link.`
        );
        authUserId = null;
        account = await createAccount({
          email,
          password,
          fullName,
          role: "parent",
          authUserId: null,
          emailConfirmed,
        });
      } else {
        throw err;
      }
    }

    // Optional PIN
    const pin = String(formData.get("pin") ?? "").trim();
    if (pin) {
      step = "setPin";
      await setPin(account.id, pin);
    }

    // Link via the invite the daycare issued and consume it. The invite's
    // relationship becomes the family-link access role (KID-112).
    if (invite.child_id) {
      step = "linkFamily";
      const { isContactRelationship } = await import("@/lib/contact-relationship");
      const inviteRole = isContactRelationship((invite as Record<string, unknown>).role)
        ? String((invite as Record<string, unknown>).role)
        : "parent";
      await linkFamily(account.id, String(invite.child_id), inviteRole);
    }
    step = "consumeInvite";
    await queryRun("UPDATE invite SET status = 'accepted' WHERE id = ?", invite.id);
  } catch (err) {
    console.error(
      `KID-121 register: activation failed at step ${step} for ${email}:`,
      err instanceof Error ? err.message : err
    );
    // KID-124: step-coded message so the next human report names the failing
    // call (auth-step codes = sign-in service, data-step codes = our write —
    // neither means "wrong password").
    return { error: activationStepError(step) };
  }
  if (!account) {
    return {
      error:
        "We couldn't activate your account right now. Try again in a moment, or ask your daycare for help.",
    };
  }

  await setSession(account.email);
  redirect(emailConfirmed ? "/child" : "/welcome");
}

export async function resendConfirmationAction() {
  if (!supabaseConfigured()) return { error: "Email confirmation is not enabled in this environment." };
  const cookie = cookies().get(SESSION_COOKIE)?.value;
  const session = cookie ? (verifyToken(decodeURIComponent(cookie)) as SessionCookie) : null;
  const email = session?.email ?? "";
  if (!email) return { error: "No signed-in account to confirm." };
  const { error } = await getSupabase().auth.resend({ type: "signup", email });
  if (error) {
    // KID-111: log resend failures instead of failing silently.
    console.error(`KID-111 resendConfirmation: GoTrue resend failed for ${email}:`, error.message);
    return { error: error.message };
  }
  console.log(`KID-111 resendConfirmation: GoTrue confirm email resent to ${email}`);
  return { ok: true };
}

// Called by /auth/confirm after Supabase verifies the email token. Marks the
// local account mirror as confirmed so password sign-in and the UI banner agree.
export async function confirmEmailAction(email: string) {
  const account = await findAccountByEmail(email);
  if (account && !emailConfirmedFor(account)) {
    await setEmailConfirmed(account.id, true);
  }
  return { ok: true };
}

// Forgot password: Supabase Auth sends the recovery email, and the /reset-password
// page completes the flow. Best-effort — the project may have no SMTP wired yet,
// in which case the UI tells the user to ask their daycare for a new invite.
export async function requestPasswordResetAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) return { error: "Enter your email address." };
  if (!supabaseConfigured()) {
    return {
      error:
        "Password reset email isn't configured yet. Ask your daycare admin to give you a new invite code.",
    };
  }
  const { error } = await getSupabase().auth.resetPasswordForEmail(email, {
    redirectTo: `${publicOrigin(requestOrigin())}/reset-password`,
  });
  if (error) {
    // KID-111: log reset-mail failures (e.g. non-routable demo addresses).
    console.error(`KID-111 passwordReset: reset email failed for ${email}:`, error.message);
    // Supabase rejects non-routable addresses (e.g. the seeded *.test demo
    // accounts) with a generic error. Point the user at the interim path.
    return {
      error:
        "We couldn't send a reset link to that address. If you're a parent or staff member, ask your daycare admin to re-invite you or set a new password.",
    };
  }
  console.log(`KID-111 passwordReset: reset email sent to ${email}`);
  return { ok: true };
}

export async function logoutAction() {
  cookies().set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  redirect("/");
}

export async function linkInviteAction(formData: FormData) {
  const code = String(formData.get("inviteCode") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const account = await findAccountByEmail(email);
  if (!account) return { error: "Account not found. Sign in first." };
  const invite = await getInviteByCode(code);
  if (!invite) return { error: "Invite code not found." };
  if (invite.child_id) {
    const { isContactRelationship } = await import("@/lib/contact-relationship");
    const inviteRole = isContactRelationship((invite as Record<string, unknown>).role)
      ? String((invite as Record<string, unknown>).role)
      : "parent";
    await linkFamily(account.id, String(invite.child_id), inviteRole);
    await queryRun("UPDATE invite SET status = 'accepted' WHERE id = ?", invite.id);
    return { ok: true };
  }
  return { error: "Invite has no linked child." };
}

// ---- Daily-loop actions (check-in/out, reports, newsfeed, messaging, consents, incidents) ----

function authAccount(): SessionCookie {
  const cookie = cookies().get(SESSION_COOKIE)?.value;
  if (!cookie) throw new Error("not signed in");
  const session = verifyToken(decodeURIComponent(cookie)) as SessionCookie | null;
  if (!session?.accountId) throw new Error("not signed in");
  return session;
}

function requireAdmin(): SessionCookie {
  const me = authAccount();
  if (!isAdminRole(me.role)) redirect("/portal/dashboard");
  return me;
}

async function firstInstituteId(): Promise<string> {
  const row = await queryGet("SELECT id FROM institute LIMIT 1");
  return String(row?.id ?? "");
}

// KID-115: the contact's display name for activation-form prefill, so invited
// parents don't retype details the daycare already has. Never throws —
// prefill is best-effort and must not break sending.
async function contactNameForInvite(
  childId: string | null,
  email: string
): Promise<string | undefined> {
  try {
    if (!childId) return undefined;
    const row = await queryGet(
      "SELECT full_name FROM contact WHERE child_id = ? AND lower(email) = lower(?) LIMIT 1",
      childId,
      email
    );
    const name = String(row?.full_name ?? "").trim().slice(0, 120);
    return name || undefined;
  } catch (err) {
    console.error(`KID-115 contactNameForInvite failed for ${email}:`, err);
    return undefined;
  }
}

// KID-103: verifies a child belongs to the current account's assigned
// classrooms. Owners/admins always pass; out-of-scope direct-action attempts
// redirect to the children list instead of silently writing data.
async function assertChildInScope(childId: string, me: SessionCookie): Promise<void> {
  const instituteId = await firstInstituteId();
  if (!instituteId) return;
  if (!(await isChildInScope(instituteId, me.accountId, childId))) {
    redirect("/portal/children?error=scope");
  }
}

// KID-112: enforces the contact-relationship access ladder server-side.
// Staff/admin account roles are unaffected; parent-role accounts are gated by
// their most-permissive family_member link (parent > family > pickup).
// no_access accounts never reach here (blocked at login) — deny defensively.
async function assertFamilyAction(me: SessionCookie, action: string): Promise<void> {
  if (me.role !== "parent") return;
  const { familyAccessForAccount } = await import("@/lib/store");
  const { isActionAllowed } = await import("@/lib/contact-relationship");
  const access = (await familyAccessForAccount(me.accountId)) ?? "parent";
  if (access === "no_access" || !isActionAllowed(access, action)) {
    redirect("/child?error=role");
  }
}

// KID-104: resolve recipient form fields into the list of child IDs a post is
// allowed to tag. Admin/owner may use the "center" channel; staff and carers
// are restricted to their assigned classrooms. Forged or out-of-scope values
// are dropped rather than silently expanded.
async function resolveNewsfeedRecipients(
  formData: FormData,
  me: SessionCookie,
  instituteId: string
): Promise<string[]> {
  const { listChildren, childrenByRooms, staffRooms } = await import("@/lib/store");
  const { queryGet } = await import("@/lib/db");
  const isAdmin = me.role === "owner" || me.role === "admin";
  const channel = String(formData.get("recipientChannel") ?? "").trim();

  let allowedRoomIds: string[] = [];
  if (!isAdmin) {
    if (me.role === "staff" || me.role === "carer") {
      const account = await queryGet("SELECT staff_id FROM account WHERE id = ?", me.accountId);
      if (account?.staff_id) {
        const roomsForStaff = await staffRooms(String(account.staff_id));
        allowedRoomIds = roomsForStaff.map((r) => String(r.id));
      }
    }
  }

  if (channel === "center") {
    if (!isAdmin) {
      throw new Error("Only center admins can post to everyone.");
    }
    return (await listChildren(instituteId)).map((c) => String(c.id));
  }

  if (channel === "rooms") {
    const requestedRoomIds = formData.getAll("recipientRoomIds").map(String).filter(Boolean);
    const roomIds = isAdmin ? requestedRoomIds : requestedRoomIds.filter((id) => allowedRoomIds.includes(id));
    return (await childrenByRooms(roomIds)).map((c) => String(c.id));
  }

  const requestedChildIds = formData.getAll("childIds").map(String).filter(Boolean);
  if (isAdmin) {
    return requestedChildIds;
  }
  if (allowedRoomIds.length === 0) {
    return [];
  }

  const children = await listChildren(instituteId);
  const allowed = new Set(allowedRoomIds);
  return requestedChildIds.filter((cid) => {
    const child = children.find((c) => String(c.id) === cid);
    return child && allowed.has(child.room_id ? String(child.room_id) : "");
  });
}

// KID-57: persist the user's app language (English | Arabic). The root layout
// and every page resolve the locale from `account.language`, and once saved the
// server action also drops the lang cookie so `dir`/`lang` apply immediately.
export async function saveLanguageAction(formData: FormData) {
  const locale = String(formData.get("locale") ?? "");
  if (locale !== "en" && locale !== "ar") redirect("/");
  const me = authAccount();
  const { setAccountLanguage } = await import("@/lib/auth");
  const account = await (await import("@/lib/auth")).getAccount(me.accountId);
  if (account) {
    await setAccountLanguage(me.accountId, locale);
  }
  cookies().set(LANG_COOKIE, locale, {
    httpOnly: false,
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 24 * 3600,
  });
  revalidatePath("/", "layout");
  redirect(homeForRole(me.role) === "/child" ? "/child" : "/portal/account");
}

export async function checkInOutAction(formData: FormData) {
  const childId = String(formData.get("childId") ?? "");
  const type = String(formData.get("type") ?? "") as "in" | "out";
  const me = authAccount();
  // KID-112: pickup role exists only to register pickup time; no_access is
  // blocked at login (defensive deny here too).
  await assertFamilyAction(me, "checkInOut");
  if (childId && (type === "in" || type === "out")) {
    await assertChildInScope(childId, me);
    // KID-58: no one can check in before the center opens.
    if (type === "in") {
      const instituteId = await firstInstituteId();
      if (instituteId) {
        const policy = await checkInAllowed(String(instituteId));
        if (!policy.allowed) {
          return { error: policy.error ?? "Check-in is not allowed at this time." };
        }
      }
    }
    await checkChildInOut({ childId, accountId: me.accountId, type });
  }
  // #7: stay in portal when invoked from portal pages instead of forcing /child/…
  const referer = headers().get("referer") ?? "";
  if (referer.includes("/portal/")) {
    redirect(referer.split("?")[0] + "?checked=1");
  }
  redirect(`/child/${childId}`);
}

export async function saveDailyReportAction(formData: FormData) {
  const childId = String(formData.get("childId") ?? "");
  const reportDate = String(formData.get("reportDate") ?? "") || new Date().toISOString().slice(0, 10);
  const me = authAccount();
  if (childId) await assertChildInScope(childId, me);
  await upsertDailyReport({
    childId,
    reportDate,
    summary: String(formData.get("summary") ?? ""),
    observation: String(formData.get("observation") ?? ""),
    mood: String(formData.get("mood") ?? ""),
    meal: JSON.stringify({
      breakfast: String(formData.get("breakfast") ?? ""),
      lunch: String(formData.get("lunch") ?? ""),
      snack: String(formData.get("snack") ?? ""),
    }),
    sleep: String(formData.get("sleep") ?? ""),
    diaper: String(formData.get("diaper") ?? ""),
    sick: formData.get("sick") === "on",
    note: String(formData.get("note") ?? ""),
    accountId: me.accountId,
  });
  redirect(`/portal/children/${childId}`);
}

export async function createNewsfeedAction(formData: FormData) {
  const me = authAccount();
  await ensureSchema();
  const instituteId = await firstInstituteId();
  await createNewsfeedPost({
    instituteId,
    accountId: me.accountId,
    body: String(formData.get("body") ?? ""),
    tagChildIds: formData.getAll("childIds").map(String),
  });
  redirect("/portal/newsfeed");
}

export async function commentAction(formData: FormData) {
  const me = authAccount();
  // KID-112: pickup accounts may only register pickup time — no commenting.
  await assertFamilyAction(me, "comment");
  await addComment(String(formData.get("postId") ?? ""), me.accountId, String(formData.get("body") ?? ""));
  redirect(formData.get("fromParent") === "1" ? "/child/newsfeed" : "/portal/newsfeed");
}

export async function createConsentAction(formData: FormData) {
  await ensureSchema();
  const me = authAccount();
  const instituteId = await firstInstituteId();
  const childId = String(formData.get("childId") ?? "") || undefined;
  if (childId) await assertChildInScope(childId, me);
  await createConsent({
    instituteId,
    title: String(formData.get("title") ?? ""),
    body: String(formData.get("body") ?? ""),
    childId,
  });
  redirect("/portal/consents");
}

export async function respondConsentAction(formData: FormData) {
  const me = authAccount();
  // KID-112: consent responses are parent-only (family/pickup denied).
  await assertFamilyAction(me, "respondConsent");
  await respondConsent(String(formData.get("id") ?? ""), String(formData.get("status") ?? "approved") as "approved" | "denied");
  redirect("/child/consents");
}

export async function createIncidentAction(formData: FormData) {
  const me = authAccount();
  await ensureSchema();
  const instituteId = await firstInstituteId();
  const childId = String(formData.get("childId") ?? "");
  if (childId) await assertChildInScope(childId, me);
  await createIncident({
    instituteId,
    childId,
    accountId: me.accountId,
    type: String(formData.get("type") ?? "incident"),
    description: String(formData.get("description") ?? ""),
  });
  redirect("/portal/incidents");
}

export async function acknowledgeIncidentAction(formData: FormData) {
  const me = authAccount();
  // KID-112: incident acknowledgement is parent-only (family/pickup denied).
  await assertFamilyAction(me, "acknowledgeIncident");
  await acknowledgeIncident(String(formData.get("id") ?? ""));
  const fromPortal = String(formData.get("portal") ?? "") === "1";
  redirect(fromPortal ? "/portal/incidents" : "/child/incidents");
}

export async function addChildAction(formData: FormData) {
  await ensureSchema();
  const me = authAccount();
  const instituteId = await firstInstituteId();

  // #4a: a child cannot exist without at least one parent/guardian who will
  // access the app. Require guardian name + relationship and at least one
  // contact channel (phone or email) up front.
  const guardianName = String(formData.get("guardianName") ?? "").trim();
  const guardianRelationship = String(formData.get("guardianRelationship") ?? "").trim();
  const guardianPhone = String(formData.get("guardianPhone") ?? "").trim();
  const guardianEmail = String(formData.get("guardianEmail") ?? "").trim();
  if (!guardianName || !guardianRelationship || (!guardianPhone && !guardianEmail)) {
    redirect("/portal/children?error=guardian");
  }
  // KID-112: relationship is a required 4-option enum — reject free text.
  const { isContactRelationship } = await import("@/lib/contact-relationship");
  if (!isContactRelationship(guardianRelationship)) {
    redirect("/portal/children?error=relationship");
  }

  // KID-103: staff can only add children to their assigned classrooms.
  const roomId = String(formData.get("roomId") ?? "") || undefined;
  if (instituteId && roomId) {
    const allowed = await scopedRoomIds(instituteId, me.accountId);
    if (allowed !== null && !allowed.includes(roomId)) {
      redirect("/portal/children?error=scope");
    }
  } else if ((me.role === "staff" || me.role === "carer") && !roomId) {
    redirect("/portal/children?error=scope");
  }

  const child = await createChild({
    instituteId,
    firstName: String(formData.get("firstName") ?? ""),
    lastName: String(formData.get("lastName") ?? ""),
    dob: String(formData.get("dob") ?? "") || undefined,
    roomId,
    allergies: String(formData.get("allergies") ?? ""),
  });
  await addContact({
    childId: child.id,
    fullName: guardianName,
    relationship: guardianRelationship,
    phone: guardianPhone || undefined,
    email: guardianEmail || undefined,
    isPickup: formData.get("guardianIsPickup") === "on",
    isEmergency: formData.get("guardianIsEmergency") === "on",
  });
  redirect(`/portal/children/${child.id}`);
}

export async function addStaffAction(formData: FormData) {
  requireAdmin();
  await ensureSchema();
  const instituteId = await firstInstituteId();
  const fullName = String(formData.get("fullName") ?? "").trim();
  const role = String(formData.get("role") ?? "carer");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const passwordInput = String(formData.get("password") ?? "").trim();
  const password = passwordInput || genTempPassword();

  const staff = await createStaff({
    instituteId,
    fullName,
    role,
    roomIds: formData.getAll("roomIds").map(String),
  });

  // #14: staff must be able to log in. When an email is supplied we create a
  // linked portal account (email + password) and record staff_id on the
  // account. The admin shares the credentials; staff can change the password
  // later via "Forgot password".
  if (email && !(await findAccountByEmail(email))) {
    await createAccount({ email, password, fullName, role: "staff" });
    await queryRun("UPDATE account SET staff_id = ? WHERE email = ?", staff.id, email);
    // Best-effort GoTrue identity so the reset-password email flow works later.
    if (supabaseConfigured()) {
      try {
        await getSupabase().auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${publicOrigin(requestOrigin())}/auth/confirm` },
        });
        console.log(`KID-111 staffInvite: GoTrue identity created for staff ${email}`);
      } catch (err) {
        // KID-111: never fail silently — the app-side account still works, but
        // the failure is logged so missing staff invite/reset emails are visible.
        console.error(`KID-111 staffInvite: GoTrue signUp failed for staff ${email}:`, err instanceof Error ? err.message : err);
      }
    }
  }

  redirect(`/portal/staff?added=1&email=${encodeURIComponent(email)}`);
}

function genTempPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 12; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

export async function addRoomAction(formData: FormData) {
  requireAdmin();
  await ensureSchema();
  const instituteId = await firstInstituteId();
  await createRoom(
    String(instituteId),
    String(formData.get("name") ?? ""),
    Number(formData.get("capacity")) || undefined,
    String(formData.get("colour") ?? "") || undefined
  );
  redirect("/portal/rooms");
}

// #6 room settings: name / colour / capacity.
export async function updateRoomAction(formData: FormData) {
  requireAdmin();
  await ensureSchema();
  const roomId = String(formData.get("roomId") ?? "");
  const capacityRaw = String(formData.get("capacity") ?? "").trim();
  await updateRoom(roomId, {
    name: String(formData.get("name") ?? ""),
    colour: String(formData.get("colour") ?? ""),
    capacity: capacityRaw ? Number(capacityRaw) : null,
  });
  redirect(`/portal/rooms/${roomId}`);
}

// #5b child status log: one timestamped entry per interaction, multiple per day.
export async function saveChildStatusAction(formData: FormData) {
  const me = authAccount();
  await ensureSchema();
  const childId = String(formData.get("childId") ?? "");
  if (childId) await assertChildInScope(childId, me);
  const kind = String(formData.get("kind") ?? "").trim();
  const value = String(formData.get("value") ?? "").trim();
  const recordedAt = String(formData.get("recordedAt") ?? "").trim();
  if (childId && kind && value) {
    await logChildStatus({
      childId,
      kind,
      value,
      note: String(formData.get("note") ?? "").trim() || undefined,
      accountId: me.accountId,
      recordedAt: recordedAt || undefined,
    });
  }
  redirect(`/portal/children/${childId}`);
}

export async function addContactAction(formData: FormData) {
  const me = authAccount();
  const childId = String(formData.get("childId") ?? "");
  if (childId) await assertChildInScope(childId, me);
  // KID-112: relationship is a required 4-option enum — reject free text.
  const relationship = String(formData.get("relationship") ?? "").trim();
  const { isContactRelationship } = await import("@/lib/contact-relationship");
  if (!isContactRelationship(relationship)) {
    redirect(`/portal/children/${childId}?error=relationship`);
  }
  await addContact({
    childId,
    fullName: String(formData.get("fullName") ?? ""),
    relationship,
    phone: String(formData.get("phone") ?? ""),
    email: String(formData.get("email") ?? ""),
    isPickup: formData.get("isPickup") === "on",
    isEmergency: formData.get("isEmergency") === "on",
  });
  redirect(`/portal/children/${childId}`);
}

export async function inviteParentAction(formData: FormData) {
  await ensureSchema();
  const me = authAccount();
  const instituteId = await firstInstituteId();
  const childId = String(formData.get("childId") ?? "") || null;
  if (childId) await assertChildInScope(childId, me);
  // KID-112: the invite carries the contact relationship so the new
  // account's family link gets the right access role on registration.
  const relationship = String(formData.get("relationship") ?? "parent").trim() || "parent";
  const { isContactRelationship } = await import("@/lib/contact-relationship");
  if (!isContactRelationship(relationship)) {
    redirect("/portal/children?error=relationship");
  }
  // KID-111: fail fast on bad input; codes are single-use tokens so reject a
  // code that is already pending instead of creating a confusing duplicate.
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const code = String(formData.get("code") ?? "").trim();
  if (!isValidInviteEmail(email)) {
    redirect("/portal/children?invite=invalid-email");
  }
  if (!isValidInviteCode(code)) {
    redirect("/portal/children?invite=invalid-code");
  }
  const duplicate = await getInviteByCode(code);
  if (duplicate && String(duplicate.status ?? "pending") === "pending") {
    console.warn(`KID-111 invite: duplicate pending code ${code} rejected for ${email}`);
    redirect(`/portal/children?invite=code-used&code=${encodeURIComponent(code)}`);
  }
  await createInvite(
    String(instituteId),
    childId,
    email,
    code,
    relationship
  );
  // KID-119: parent devices fetch this link, so use the public host.
  const origin = publicOrigin(requestOrigin());
  // Log the canonical activation message so the invite is verifiable in logs
  // even when no mail provider is wired.
  let childName: string | undefined;
  if (childId) {
    const child = await queryGet("SELECT first_name, last_name FROM child WHERE id = ?", childId);
    if (child) childName = `${String(child.first_name ?? "")} ${String(child.last_name ?? "")}`.trim() || undefined;
  }
  // Prefill the activation form with the contact's name so invited parents
  // don't retype details the daycare already has (KID-115).
  const parentName = await contactNameForInvite(childId, email);
  const preview = buildParentInviteEmail({ parentEmail: email, code, childName, parentName, origin: origin || "(unknown origin)" });
  console.log(`KID-111 invite created for ${email} (code ${code}):\n${preview.text}`);
  const created = await getInviteByCode(code);
  // KID-111: attempt delivery and record the outcome (sent / pending / failed)
  // so a missing activation email is visible instead of silently lost.
  const result = created ? await sendParentInviteEmail(created, { origin, prefill: { email, name: parentName } }) : { status: "failed" as const, detail: "invite row not found after create" };
  const params = new URLSearchParams({ invite: result.status, email });
  if (result.activationUrl) params.set("activationUrl", result.activationUrl);
  if (result.status !== "sent") params.set("inviteDetail", result.detail);
  redirect(`/portal/children?${params.toString()}`);
}

// KID-111: resend a pending parent invite — the activation path for existing
// unactivated parents. If the parent already registered but never confirmed,
// prefer the GoTrue confirmation resend; otherwise re-attempt invite delivery.
// Always bumps resend_count and logs the outcome. Returns a result object
// (no redirect) so both form and client-component callers can render feedback.
export async function resendParentInviteAction(formData: FormData) {
  await ensureSchema();
  const me = authAccount();
  if (!isAdminRole(me.role)) return { error: "Only admins can resend invites." };
  const inviteId = String(formData.get("inviteId") ?? "").trim();
  const invite = inviteId ? await getInviteById(inviteId) : undefined;
  if (!invite) return { error: "Invite not found." };
  if (String(invite.status ?? "pending") !== "pending") return { error: "That invite was already used." };
  const email = String(invite.email ?? "").trim().toLowerCase();
  // KID-111 + KID-113: share the resend rate limit and audit log so invite
  // resends and account resends have one trail and one budget.
  const {
    decideRateLimit,
    countRecentResendsForEmail,
    countRecentResendsForAdmin,
    logResendAttempt,
  } = await import("@/lib/activation");
  const [recentForEmail, recentForAdmin] = await Promise.all([
    countRecentResendsForEmail(email),
    countRecentResendsForAdmin(me.accountId),
  ]);
  const decision = decideRateLimit(recentForEmail, recentForAdmin);
  if (decision.limited) {
    const { recordInviteEmailAttempt } = await import("@/lib/invite-email");
    await recordInviteEmailAttempt({ inviteId: String(invite.id), ok: false, error: decision.reason, isResend: true });
    await logResendAttempt({
      targetEmail: email,
      adminAccountId: me.accountId,
      channel: "invite",
      status: "rate_limited",
      detail: decision.reason,
    });
    return { error: decision.reason };
  }

  // Registered-but-unconfirmed parent: resend the GoTrue confirmation email.
  if (supabaseConfigured()) {
    const account = await findAccountByEmail(email);
    if (account && !emailConfirmedFor(account)) {
      const { error } = await getSupabase().auth.resend({ type: "signup", email });
      const { recordInviteEmailAttempt } = await import("@/lib/invite-email");
      if (!error) {
        console.log(`KID-111 resendInvite: GoTrue confirm email resent to ${email} (invite ${String(invite.id)})`);
        await recordInviteEmailAttempt({ inviteId: String(invite.id), ok: true, isResend: true });
        await logResendAttempt({
          targetEmail: email,
          adminAccountId: me.accountId,
          channel: "supabase",
          status: "sent",
          detail: `invite ${String(invite.id)} resend via signup confirm.`,
        });
        return { ok: true as const };
      }
      console.error(`KID-111 resendInvite: GoTrue resend failed for ${email}:`, error.message);
      // Fall through to the invite-delivery attempt below; the failure is
      // recorded there along with the recovery outcome.
    }
  }

  // KID-119: parent devices fetch this link, so use the public host.
  const origin = publicOrigin(requestOrigin());
  const parentName = await contactNameForInvite(
    invite.child_id ? String(invite.child_id) : null,
    email
  );
  const result = await sendParentInviteEmail(invite, {
    origin,
    isResend: true,
    prefill: { email, name: parentName },
  });
  await logResendAttempt({
    targetEmail: email,
    adminAccountId: me.accountId,
    channel: result.status === "sent" ? "supabase-admin-invite" : "invite",
    status: result.status === "sent" ? "sent" : "failed",
    detail: `invite ${String(invite.id)} resend: ${result.detail}`,
  });
  if (result.status === "sent") return { ok: true as const };
  return {
    error: result.activationUrl
      ? `${result.detail} Manual link: ${result.activationUrl}`
      : result.detail,
  };
}

// KID-115: one-click invite send from the child-detail family tab. Creates a
// pending invite with a server-generated code for a contact email and sends
// it through the admin-invite channel — no navigation, no manual code entry.
// Returns a result object so the button confirms inline like the resend
// buttons. Logs every attempt on the invite row + activation_resend_log.
export async function sendInviteForContactAction(formData: FormData) {
  await ensureSchema();
  const me = authAccount();
  if (!isAdminRole(me.role)) return { error: "Only admins can send invites." };
  const instituteId = await firstInstituteId();
  if (!instituteId) return { error: "No center configured yet." };
  const childId = String(formData.get("childId") ?? "").trim();
  if (!childId) return { error: "Missing child." };
  await assertChildInScope(childId, me);
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  // Normalize (never reject): stored contact relationships predate the
  // 4-role enum or may be blank — KID-115 showed "Unknown relationship"
  // blocking real parents. Legacy values map to the canonical role.
  const { normalizeLegacyRelationship } = await import("@/lib/contact-relationship");
  const relationship = normalizeLegacyRelationship(String(formData.get("relationship") ?? "parent"));
  if (!isValidInviteEmail(email)) return { error: "Enter a valid email address." };

  const {
    generateInviteCode,
    sendParentInviteEmail,
    getPendingInvitesByEmail,
    buildParentInviteEmail,
  } = await import("@/lib/invite-email");
  // Reuse an existing pending invite instead of stacking duplicates.
  const existing = await getPendingInvitesByEmail(email);
  // KID-119: parent devices fetch this link, so use the public host.
  const origin = publicOrigin(requestOrigin());
  if (existing.length > 0) {
    const parentName = await contactNameForInvite(childId, email);
    const result = await sendParentInviteEmail(existing[0], {
      origin,
      isResend: true,
      prefill: { email, name: parentName },
    });
    const { logResendAttempt } = await import("@/lib/activation");
    await logResendAttempt({
      targetEmail: email,
      adminAccountId: me.accountId,
      channel: result.status === "sent" ? "supabase-admin-invite" : "invite",
      status: result.status === "sent" ? "sent" : "failed",
      detail: `contact send reused invite ${String(existing[0].id)}: ${result.detail}`,
    });
    if (result.status === "sent") return { ok: true as const };
    return {
      error: result.activationUrl
        ? `${result.detail} Manual link: ${result.activationUrl}`
        : result.detail,
    };
  }

  let code = "";
  for (let i = 0; i < 5 && !code; i++) {
    const candidate = generateInviteCode();
    if (!(await getInviteByCode(candidate))) code = candidate;
  }
  if (!code) return { error: "Could not create an invite code. Try again." };
  try {
    await createInvite(instituteId, childId, email, code, relationship);
  } catch (err) {
    console.error(`KID-115 contact send: createInvite failed for ${email}:`, err);
    return { error: err instanceof Error ? err.message : "Could not create the invite." };
  }
  const created = await getInviteByCode(code);
  const parentName = await contactNameForInvite(childId, email);
  const preview = buildParentInviteEmail({ parentEmail: email, code, parentName, origin: origin || "(unknown origin)" });
  console.log(`KID-115 contact send: invite created for ${email} (code ${code}):\n${preview.text}`);
  const result = created
    ? await sendParentInviteEmail(created, { origin, prefill: { email, name: parentName } })
    : { status: "failed" as const, detail: "invite row not found after create" };
  const { logResendAttempt } = await import("@/lib/activation");
  await logResendAttempt({
    targetEmail: email,
    adminAccountId: me.accountId,
    channel: result.status === "sent" ? "supabase-admin-invite" : "invite",
    status: result.status === "sent" ? "sent" : "failed",
    detail: `contact send, invite ${created ? String(created.id) : "?"}: ${result.detail}`,
  });
  if (result.status === "sent") return { ok: true as const };
  return {
    error:
      result.status === "pending" && result.activationUrl
        ? `Invite saved but no mail provider is configured. Manual link: ${result.activationUrl}`
        : result.detail,
  };
}

export async function saveBrandingAction(formData: FormData) {
  requireAdmin();
  await ensureSchema();
  const instituteId = await firstInstituteId();
  if (instituteId) {
    await updateInstitute(String(instituteId), {
      name: String(formData.get("name") ?? ""),
      primary_color: String(formData.get("primaryColor") ?? "#3B82F6"),
      accent_color: String(formData.get("accentColor") ?? "#10B981"),
      font: String(formData.get("font") ?? "Inter"),
    });
  }
  redirect("/portal/settings");
}

export async function saveCenterDetailsAction(formData: FormData) {
  requireAdmin();
  await ensureSchema();
  const instituteId = await firstInstituteId();
  if (instituteId) {
    const patch: Record<string, unknown> = {};
    const name = String(formData.get("name") ?? "").trim();
    const contact = String(formData.get("contact") ?? "").trim();
    const address = String(formData.get("address") ?? "").trim();
    if (name) patch.name = name;
    patch.contact = contact || null;
    patch.address = address || null;
    await updateInstitute(String(instituteId), patch);
  }
  redirect("/portal/settings");
}

// KID-55 item 3 / KID-58: per-day open/close editor persisted on the institute.
export async function saveWorkingHoursAction(formData: FormData) {
  requireAdmin();
  await ensureSchema();
  const instituteId = await firstInstituteId();
  if (!instituteId) return { ok: false, error: "No center configured." };
  const week: WorkingWeek = {};
  for (let day = 0; day <= 6; day++) {
    if (formData.get(`closed_${day}`) === "on") continue;
    const open = String(formData.get(`open_${day}`) ?? "").trim();
    const close = String(formData.get(`close_${day}`) ?? "").trim();
    if (open && close) week[String(day)] = { open, close };
  }
  await saveWorkingHours(String(instituteId), week);
  return { ok: true, days: Object.keys(week).length };
}

// KID-58: run the auto check-out sweep now (also runs when attendance
// surfaces load). Kept as an action so it can be triggered from the UI or a
// scheduler dispatcher.
export async function runAttendanceSweepAction() {
  await ensureSchema();
  const instituteId = await firstInstituteId();
  const result = instituteId
    ? await runAutoCheckoutSweep(String(instituteId))
    : { children: [], staff: [], at: "", reason: null, cutoff: null };
  redirect(`/portal/attendance?sweep=1&children=${result.children.length}`);
}

export async function submitContactAction(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const role = String(formData.get("role") ?? "parent");
  const interest = String(formData.get("interest") ?? "demo");
  const message = String(formData.get("message") ?? "").trim();

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (!name || name.length > 120) redirect("/contact?error=name");
  if (!emailOk || email.length > 200) redirect("/contact?error=email");
  if (message.length > 2000) redirect("/contact?error=long");

  try {
    await ensureSchema();
    await createContactRequest({ name, email, phone, role, interest, message });
  } catch (err) {
    console.error("submitContactAction failed:", err);
    redirect("/contact?error=server");
  }
  redirect("/contact?sent=1");
}

// ---- T5 / M5 extra kept areas: server actions ----

function requireInstitute(): Promise<string> {
  return (async () => {
    await ensureSchema();
    return firstInstituteId();
  })();
}

export async function createEventAction(formData: FormData) {
  const me = authAccount();
  const instituteId = await requireInstitute();
  if (instituteId) {
    await createEvent({
      instituteId,
      title: String(formData.get("title") ?? ""),
      eventDate: String(formData.get("eventDate") ?? ""),
      startTime: String(formData.get("startTime") ?? "") || undefined,
      endTime: String(formData.get("endTime") ?? "") || undefined,
      location: String(formData.get("location") ?? "") || undefined,
      description: String(formData.get("description") ?? "") || undefined,
      accountId: me.accountId,
    });

    // KID-104 #11: activities respect the selected recipients by posting the
    // new activity to the newsfeed tagged to the chosen children/rooms.
    const tagChildIds = await resolveNewsfeedRecipients(formData, me, instituteId);
    if (tagChildIds.length > 0) {
      const title = String(formData.get("title") ?? "").trim();
      const eventDate = String(formData.get("eventDate") ?? "").trim();
      const location = String(formData.get("location") ?? "").trim();
      const description = String(formData.get("description") ?? "").trim();
      const body = `Activity: ${title}${eventDate ? ` (${eventDate})` : ""}${location ? ` @ ${location}` : ""}${description ? ` — ${description}` : ""}`;
      await createNewsfeedPost({ instituteId, accountId: me.accountId, body, tagChildIds });
    }
  }
  // KID-55 #10: activities page posts inline with returnTo=/portal/learning/activities.
  const returnTo = String(formData.get("returnTo") ?? "");
  redirect(returnTo.startsWith("/portal/") ? returnTo : "/portal/events");
}

export async function addEventMediaAction(formData: FormData) {
  const me = authAccount();
  const instituteId = await requireInstitute();
  const eventId = String(formData.get("eventId") ?? "");
  if (instituteId && eventId) {
    await addEventMedia({
      eventId,
      instituteId,
      url: String(formData.get("url") ?? ""),
      kind: String(formData.get("kind") ?? "image"),
      caption: String(formData.get("caption") ?? "") || undefined,
      accountId: me.accountId,
    });
  }
  redirect(`/portal/events?open=${eventId}`);
}

export async function createFormAction(formData: FormData) {
  const me = authAccount();
  const instituteId = await requireInstitute();
  const title = String(formData.get("title") ?? "");
  const kind = String(formData.get("kind") ?? "form");
  let fieldsJson = [];
  for (let i = 0; i < 20; i++) {
    const label = String(formData.get(`field_${i}_label`) ?? "").trim();
    if (!label) continue;
    const ftype = String(formData.get(`field_${i}_type`) ?? "text").trim();
    const options = String(formData.get(`field_${i}_options`) ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    fieldsJson.push({ id: `f${i}`, label, type: ftype, required: formData.get(`field_${i}_required`) === "on", options });
  }
  if (instituteId && title) {
    await createForm({
      instituteId,
      kind,
      title,
      description: String(formData.get("description") ?? ""),
      fieldsJson: JSON.stringify(fieldsJson),
      accountId: me.accountId,
    });
  }
  // KID-52 #10: allow callers (e.g. the Surveys tab) to create forms/surveys
  // without leaving their page — a relative returnTo wins over /portal/forms.
  const rawReturnTo = String(formData.get("returnTo") ?? "/portal/forms");
  const returnTo = rawReturnTo.startsWith("/portal/") ? rawReturnTo : "/portal/forms";
  redirect(returnTo);
}

export async function submitFormAction(formData: FormData) {
  const me = authAccount();
  // KID-112: form submissions are parent-only (family/pickup denied).
  await assertFamilyAction(me, "submitForm");
  const formId = String(formData.get("formId") ?? "");
  await ensureSchema();
  const answers: Record<string, string> = {};
  for (let i = 0; i < 20; i++) {
    if (formData.get(`field_${i}_label`) === null) continue;
    const key = String(formData.get(`field_${i}_key`) ?? `field_${i}`);
    answers[key] = String(formData.get(`field_${i}`) ?? "").trim();
  }
  await saveFormResponse({
    formId,
    accountId: me.accountId,
    childId: String(formData.get("childId") ?? "") || undefined,
    answersJson: JSON.stringify(answers),
  });
  redirect(`/child/forms?sent=${formId}`);
}

export async function createTagAction(formData: FormData) {
  const instituteId = await requireInstitute();
  if (instituteId) {
    await createTag(
      String(instituteId),
      String(formData.get("name") ?? ""),
      String(formData.get("color") ?? "#3B82F6")
    );
  }
  redirect("/portal/tags");
}

export async function setChildTagsAction(formData: FormData) {
  const me = authAccount();
  const childId = String(formData.get("childId") ?? "");
  if (childId) {
    await assertChildInScope(childId, me);
    await setChildTags(childId, formData.getAll("tagIds").map(String));
  }
  redirect(`/portal/children/${childId}`);
}

export async function addDriveFileAction(formData: FormData) {
  const me = authAccount();
  const instituteId = await requireInstitute();
  const childId = String(formData.get("childId") ?? "") || undefined;
  if (instituteId) {
    if (childId) await assertChildInScope(childId, me);
    // #4: upload from local drive only — no file-URL input, no size field.
    const uploaded = formData.get("file");
    let filename = String(formData.get("filename") ?? "").trim();
    let url = "";
    let kind = String(formData.get("kind") ?? "file");
    let sizeBytes: number | undefined;
    if (uploaded instanceof File && uploaded.size > 0) {
      filename = filename || uploaded.name || "upload";
      sizeBytes = uploaded.size;
      const buf = Buffer.from(await uploaded.arrayBuffer());
      const mime = uploaded.type || "application/octet-stream";
      if (kind === "file") {
        if (mime.startsWith("image/")) kind = "photo";
        else if (mime === "application/pdf") kind = "pdf";
        else if (mime.startsWith("video/")) kind = "video";
      }
      url = `data:${mime};base64,${buf.toString("base64")}`;
    } else {
      // Back-compat: older form posts still carry url/sizeBytes
      url = String(formData.get("url") ?? "");
      sizeBytes = Number(formData.get("sizeBytes")) || undefined;
    }
    if (filename && url) {
      await addDriveFile({
        instituteId,
        filename,
        url,
        kind,
        sizeBytes,
        description: String(formData.get("description") ?? ""),
        childId,
        accountId: me.accountId,
      });
    }
  }
  redirect("/portal/drive");
}

export async function createObservationAction(formData: FormData) {
  const me = authAccount();
  const instituteId = await requireInstitute();
  const childId = String(formData.get("childId") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  // #6: validate before write so a bad child/body can't crash the server component
  if (!instituteId || !childId || !body) {
    redirect("/portal/learning?error=observation");
  }
  await assertChildInScope(childId, me);
  const { ensureCurriculumSeeded } = await import("@/lib/curriculum");
  // KID-47 fix: seeding must never break observation logging on the live DB.
  try {
    await ensureCurriculumSeeded();
  } catch {}
  const ageGroup = String(formData.get("ageGroup") ?? "").trim();
  let learningPointId: string | undefined =
    String(formData.get("learningPointId") ?? "") || undefined;
  let milestoneId: string | undefined =
    String(formData.get("milestoneId") ?? "") || undefined;
  // #6: stale/tampered curriculum ids must not raise FK violations — null them
  if (learningPointId) {
    const lp = await queryGet("SELECT id FROM curriculum_learning_point WHERE id = ?", learningPointId);
    if (!lp) learningPointId = undefined;
  }
  if (milestoneId) {
    const ms = await queryGet("SELECT id FROM curriculum_milestone WHERE id = ?", milestoneId);
    if (!ms) milestoneId = undefined;
  }
  // KID-55 #7: single curriculum goal (radio). Older multi-goal posts still
  // validate — keep the first as milestone_id and persist the valid set.
  let curriculumGoalIds: string[] | undefined;
  const rawGoals = formData.getAll("goalIds").map(String).filter(Boolean);
  if (rawGoals.length > 0) {
    const unique = Array.from(new Set(rawGoals));
    if (!milestoneId) milestoneId = unique[0];
    const existing = await queryAll(
      `SELECT id FROM curriculum_milestone WHERE id IN (${unique.map(() => "?").join(", ")})`,
      ...unique
    );
    const valid = new Set(existing.map((e) => String(e.id)));
    curriculumGoalIds = unique.filter((id) => valid.has(id));
    if (curriculumGoalIds.length > 0 && !learningPointId) {
      learningPointId = await curriculumPointForMilestone(curriculumGoalIds[0]);
    }
  }
  await createObservation({
    instituteId,
    childId,
    accountId: me.accountId,
    kind: String(formData.get("kind") ?? "observation"),
    title: String(formData.get("title") ?? "") || undefined,
    body,
    ageGroup: ageGroup || undefined,
    learningPointId,
    milestoneId,
    curriculumGoalIds,
    recordedAt: String(formData.get("recordedAt") ?? "") || undefined,
  });
  redirect("/portal/learning");
}

async function curriculumPointForMilestone(milestoneId: string): Promise<string | undefined> {
  const row = await queryGet("SELECT learning_point_id FROM curriculum_milestone WHERE id = ?", milestoneId);
  return row ? String(row.learning_point_id) : undefined;
}

export async function accountName(accountId: string): Promise<string> {
  const row = await queryGet("SELECT COALESCE(full_name, email, id) AS name FROM account WHERE id = ?", accountId);
  return row ? String(row.name) : accountId;
}

export async function createSupportTicketAction(formData: FormData) {
  const me = authAccount();
  // KID-112: support tickets are parent-only (family/pickup denied).
  await assertFamilyAction(me, "createSupportTicket");
  const instituteId = await requireInstitute();
  if (instituteId) {
    await createSupportTicket({
      instituteId,
      accountId: me.accountId,
      subject: String(formData.get("subject") ?? ""),
      body: String(formData.get("body") ?? ""),
    });
  }
  redirect("/child/support?sent=1");
}

export async function setTicketStatusAction(formData: FormData) {
  const ticketId = String(formData.get("ticketId") ?? "");
  const status = String(formData.get("status") ?? "open");
  if (ticketId) {
    await setTicketStatus(ticketId, status);
  }
  redirect("/portal/support");
}

export async function sendMessageAction(formData: FormData) {
  const me = authAccount();
  const recipient = String(formData.get("recipientId") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  await ensureSchema();
  const instituteId = await firstInstituteId();
  if (recipient && body && instituteId) {
    const { latestPairThread } = await import("@/lib/store");
    const threadId = await latestPairThread(me.accountId, recipient);
    await sendMessage({ instituteId, senderAccountId: me.accountId, recipientAccountId: recipient, body, threadId });
  }
  redirect(`/portal/messages?with=${recipient}`);
}

// KID-56: composer send — parents and/or whole-class channels, with the
// "make it group message" toggle. Group on: one shared thread, every reply
// stays visible to all. Group off: one private thread per recipient.
export async function sendComposerAction(formData: FormData) {
  const me = authAccount();
  await ensureSchema();
  const instituteId = await firstInstituteId();
  const body = String(formData.get("body") ?? "").trim();
  if (!instituteId || !body) redirect("/portal/messages");
  const { parentAccountsScoped, roomParentIds, scopedRoomIds, createMessageThread } = await import("@/lib/store");

  const pickedParents = formData.getAll("recipients").map(String).filter(Boolean);
  const pickedRooms = formData.getAll("channels").map(String).filter(Boolean);
  const groupMode = String(formData.get("groupMode") ?? "") === "on";

  // Resolve + scope-check: parents must be in the sender's classroom scope,
  // channels must be rooms in scope.
  const allowedParents = new Set((await parentAccountsScoped(String(instituteId), me.accountId)).map((p) => String(p.id)));
  const scopeRooms = await scopedRoomIds(String(instituteId), me.accountId);
  const allowedRooms = new Set(
    scopeRooms === null
      ? (await (await import("@/lib/store")).listRooms(String(instituteId))).map((r) => String(r.id))
      : scopeRooms
  );
  const recipientIds = new Set<string>();
  for (const pid of pickedParents) if (allowedParents.has(pid) && pid !== me.accountId) recipientIds.add(pid);
  const channelNames: string[] = [];
  for (const rid of pickedRooms) {
    if (!allowedRooms.has(rid)) continue;
    const room = await (await import("@/lib/store")).getRoom(rid);
    if (room) channelNames.push(String(room.name));
    for (const pid of await roomParentIds(String(instituteId), rid)) {
      if (pid !== me.accountId) recipientIds.add(pid);
    }
  }
  if (recipientIds.size === 0) redirect("/portal/messages?error=norecipients");

  const recipients = Array.from(recipientIds);
  if (groupMode) {
    const names = (await parentAccountsScoped(String(instituteId), me.accountId)).filter((p) => recipientIds.has(String(p.id)));
    const title = channelNames.length > 0 ? channelNames.join(", ") : names.map((p) => String(p.full_name)).slice(0, 3).join(", ");
    const thread = await createMessageThread({
      instituteId: String(instituteId),
      title,
      isGroup: true,
      createdBy: me.accountId,
      participantIds: recipients,
    });
    for (const rid of recipients) {
      await sendMessage({ instituteId: String(instituteId), senderAccountId: me.accountId, recipientAccountId: rid, body, threadId: String(thread.id) });
    }
    redirect(`/portal/messages?thread=${thread.id}`);
  }
  // Private mode: one private thread per recipient.
  let firstThread: string | null = null;
  for (const rid of recipients) {
    const thread = await createMessageThread({
      instituteId: String(instituteId),
      isGroup: false,
      createdBy: me.accountId,
      participantIds: [rid],
    });
    await sendMessage({ instituteId: String(instituteId), senderAccountId: me.accountId, recipientAccountId: rid, body, threadId: String(thread.id) });
    if (!firstThread) firstThread = String(thread.id);
  }
  redirect(firstThread ? `/portal/messages?thread=${firstThread}` : "/portal/messages");
}

// KID-56: reply inside a thread — fans out to every other participant so a
// group reply stays in the same shared thread for all to see.
export async function replyThreadAction(formData: FormData) {
  const me = authAccount();
  await ensureSchema();
  const instituteId = await firstInstituteId();
  const threadId = String(formData.get("threadId") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  const returnTo = String(formData.get("returnTo") ?? "");
  if (!instituteId || !threadId || !body) redirect("/portal/messages");
  const { threadForViewer, threadParticipantIds } = await import("@/lib/store");
  const thread = await threadForViewer(threadId, me.accountId);
  if (!thread) redirect("/portal/messages?error=thread");
  const others = (await threadParticipantIds(threadId)).filter((pid) => pid !== me.accountId);
  for (const rid of others) {
    await sendMessage({ instituteId: String(instituteId), senderAccountId: me.accountId, recipientAccountId: rid, body, threadId });
  }
  const fallback = returnTo.startsWith("/child/") ? "/child/messages" : `/portal/messages?thread=${threadId}`;
  redirect(returnTo.startsWith("/") ? returnTo : fallback);
}

export async function sendParentMessageAction(formData: FormData) {
  const me = authAccount();
  // KID-112: pickup accounts may only register pickup time — no messaging.
  await assertFamilyAction(me, "sendMessage");
  const recipient = String(formData.get("recipientId") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  const threadId = String(formData.get("threadId") ?? "");
  await ensureSchema();
  const instituteId = await firstInstituteId();
  if (recipient && body && instituteId) {
    const { latestPairThread, threadForViewer, threadParticipantIds } = await import("@/lib/store");
    if (threadId) {
      // Reply inside a thread: fan out to every other participant so group
      // threads stay shared, private threads stay private.
      const thread = await threadForViewer(threadId, me.accountId);
      if (thread) {
        const others = (await threadParticipantIds(threadId)).filter((pid) => pid !== me.accountId);
        for (const rid of others) {
          await sendMessage({ instituteId, senderAccountId: me.accountId, recipientAccountId: rid, body, threadId });
        }
      }
    } else {
      const tid = await latestPairThread(me.accountId, recipient);
      await sendMessage({ instituteId, senderAccountId: me.accountId, recipientAccountId: recipient, body, threadId: tid });
    }
  }
  redirect(threadId ? `/child/messages?thread=${threadId}` : "/child/messages");
}

// ---- #1 Logo / branding image upload ----
export async function uploadBrandingImageAction(formData: FormData) {
  requireAdmin();
  await ensureSchema();
  const instituteId = await firstInstituteId();
  if (!instituteId) redirect("/portal/settings");
  const file = formData.get("file") as File | null;
  const kind = String(formData.get("kind") ?? "logo"); // "logo" | "brandImage"
  if (!file || file.size === 0) redirect("/portal/settings");

  const ext = file.name.split(".").pop() || "png";
  const filename = `branding/${instituteId}/${kind}-${Date.now()}.${ext}`;

  const { supabaseConfigured, getSupabase } = await import("@/lib/supabase");
  if (supabaseConfigured()) {
    const supabase = getSupabase();
    const { error } = await supabase.storage
      .from("kiddy-public")
      .upload(filename, file, { contentType: file.type, upsert: true });
    if (!error) {
      const { data: urlData } = supabase.storage.from("kiddy-public").getPublicUrl(filename);
      const column = kind === "logo" ? "logo_url" : "brand_image_url";
      await updateInstitute(instituteId, { [column]: urlData.publicUrl });
    }
  }
  redirect("/portal/settings");
}

// ---- #5a / #7b Photo upload ----
export async function uploadPhotoAction(formData: FormData) {
  await ensureSchema();
  const me = authAccount();
  const entityType = String(formData.get("entityType") ?? ""); // "child" | "staff"
  const entityId = String(formData.get("entityId") ?? "");
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0 || !entityType || !entityId) {
    redirect(entityType === "child" ? "/portal/children" : "/portal/staff");
  }
  if (entityType === "child") await assertChildInScope(entityId, me);

  const ext = file.name.split(".").pop() || "jpg";
  const filename = `${entityType}/${entityId}/photo-${Date.now()}.${ext}`;

  const { supabaseConfigured, getSupabase } = await import("@/lib/supabase");
  if (supabaseConfigured()) {
    const supabase = getSupabase();
    const { error } = await supabase.storage
      .from("kiddy-public")
      .upload(filename, file, { contentType: file.type, upsert: true });
    if (!error) {
      const { data: urlData } = supabase.storage.from("kiddy-public").getPublicUrl(filename);
      if (entityType === "child") {
        await updateChildPhoto(entityId, urlData.publicUrl);
      } else {
        await updateStaffPhoto(entityId, urlData.publicUrl);
      }
    }
  }
  redirect(entityType === "child" ? `/portal/children/${entityId}` : "/portal/staff");
}

// KID-107: staff upload their own photo from Account Settings.
export async function uploadAccountPhotoAction(formData: FormData) {
  await ensureSchema();
  const me = authAccount();
  const staffId = String(formData.get("staffId") ?? "");
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0 || !staffId) {
    redirect("/portal/account");
  }
  // Staff may only update their own linked profile.
  const myStaffId = await staffIdForAccount(me.accountId);
  if (!myStaffId || myStaffId !== staffId) {
    redirect("/portal/account");
  }

  const ext = file.name.split(".").pop() || "jpg";
  const filename = `staff/${staffId}/photo-${Date.now()}.${ext}`;

  const { supabaseConfigured, getSupabase } = await import("@/lib/supabase");
  if (supabaseConfigured()) {
    const supabase = getSupabase();
    const { error } = await supabase.storage
      .from("kiddy-public")
      .upload(filename, file, { contentType: file.type, upsert: true });
    if (!error) {
      const { data: urlData } = supabase.storage.from("kiddy-public").getPublicUrl(filename);
      await updateStaffPhoto(staffId, urlData.publicUrl);
    }
  }
  redirect("/portal/account");
}

// KID-55 #5: edit child's details from the About tab.
export async function updateChildDetailsAction(formData: FormData) {
  await ensureSchema();
  const me = authAccount();
  const childId = String(formData.get("childId") ?? "");
  if (!childId) redirect("/portal/children");
  await assertChildInScope(childId, me);
  // KID-103: staff cannot move a child to an unassigned classroom.
  const instituteId = await firstInstituteId();
  const roomId = String(formData.get("roomId") ?? "") || null;
  if (instituteId && roomId) {
    const allowed = await scopedRoomIds(instituteId, me.accountId);
    if (allowed !== null && !allowed.includes(roomId)) {
      redirect("/portal/children?error=scope");
    }
  }
  const { updateChildDetails } = await import("@/lib/store");
  await updateChildDetails(childId, {
    firstName: String(formData.get("firstName") ?? "").trim() || undefined,
    lastName: String(formData.get("lastName") ?? "").trim() || undefined,
    dob: String(formData.get("dob") ?? "") || null,
    gender: String(formData.get("gender") ?? "") || null,
    roomId,
    status: String(formData.get("status") ?? "") || null,
    lastDate: String(formData.get("lastDate") ?? "") || null,
  });
  redirect(`/portal/children/${childId}`);
}

// ---- #4b Admin child billing ----
export async function addChildBillingAction(formData: FormData) {
  await ensureSchema();
  const me = authAccount();
  const instituteId = await firstInstituteId();
  const childId = String(formData.get("childId") ?? "");
  if (!instituteId || !childId) redirect("/portal/children");
  await assertChildInScope(childId, me);
  await createChildBilling({
    childId,
    instituteId,
    description: String(formData.get("description") ?? ""),
    amountCents: Math.round(Number(formData.get("amountCents") ?? 0)),
    currency: String(formData.get("currency") ?? "CAD"),
    period: String(formData.get("period") ?? "") || undefined,
    dueDate: String(formData.get("dueDate") ?? "") || undefined,
    status: String(formData.get("status") ?? "pending"),
  });
  redirect(`/portal/children/${childId}/billing`);
}

export async function updateBillingStatusAction(formData: FormData) {
  const me = authAccount();
  const billingId = String(formData.get("billingId") ?? "");
  const status = String(formData.get("status") ?? "pending");
  const childId = String(formData.get("childId") ?? "");
  if (childId) await assertChildInScope(childId, me);
  if (billingId) {
    await updateChildBilling(billingId, { status });
  }
  redirect(`/portal/children/${childId}/billing`);
}

// ---- #8 Newsfeed likes (client calls this) ----
export async function toggleLikeAction(formData: FormData) {
  const me = authAccount();
  // KID-112: pickup accounts may only register pickup time — no likes.
  await assertFamilyAction(me, "toggleLike");
  const postId = String(formData.get("postId") ?? "");
  if (postId) {
    await toggleLike(postId, me.accountId);
  }
  const referer = headers().get("referer") || "/portal/newsfeed";
  redirect(referer);
}

// ---- #3 Newsfeed post with local-drive attachment (no URL field) ----
export async function createNewsfeedWithAttachmentAction(formData: FormData) {
  const me = authAccount();
  await ensureSchema();
  const instituteId = await firstInstituteId();
  const body = String(formData.get("body") ?? "");
  let mediaUrl: string | undefined;
  const attachment = formData.get("attachment");
  if (attachment instanceof File && attachment.size > 0 && attachment.size <= 2_500_000) {
    const buf = Buffer.from(await attachment.arrayBuffer());
    const mime = attachment.type || "application/octet-stream";
    mediaUrl = `data:${mime};base64,${buf.toString("base64")}`;
  }

  // KID-53 #1 / KID-104 #6: pre-defined recipient channels scoped by role.
  // The helper also enforces on the server that only admins may use Center.
  const tagChildIds = await resolveNewsfeedRecipients(formData, me, instituteId);
  if (body) {
    await createNewsfeedPost({ instituteId, accountId: me.accountId, body, mediaUrl, tagChildIds });
  }
  redirect("/portal/newsfeed");
}

// ---- KID-47 Round 6: homework assign (#8) ----
export async function assignHomeworkAction(formData: FormData) {
  const me = authAccount();
  await ensureSchema();
  const { createHomework, createNewsfeedPost, listChildren } = await import("@/lib/store");
  const instituteId = await requireInstitute();
  const title = String(formData.get("title") ?? "").trim();
  if (instituteId && title) {
    const childId = String(formData.get("childId") ?? "") || undefined;
    const isAdmin = me.role === "owner" || me.role === "admin";
    if (childId) {
      await assertChildInScope(childId, me);
    } else if (!isAdmin) {
      redirect("/portal/learning/homework?error=scope");
    }
    const dueDate = String(formData.get("dueDate") ?? "") || undefined;
    const description = String(formData.get("description") ?? "");
    await createHomework({
      instituteId,
      childId,
      title,
      description,
      dueDate,
      accountId: me.accountId,
    });
    // KID-47 fix: parents only see tag-filtered posts in the parent newsfeed,
    // so every homework assignment posts there — tagged to its child, or to
    // all children when assigned center-wide ("All children").
    try {
      const tagChildIds = childId
        ? [childId]
        : (await listChildren(instituteId, { accountId: me.accountId })).map((c) => String(c.id));
      if (tagChildIds.length > 0) {
        await createNewsfeedPost({
          instituteId,
          accountId: me.accountId,
          body: `Homework: ${title}${dueDate ? ` (due ${dueDate.slice(0, 10)})` : ""}${description ? ` — ${description}` : ""}`,
          tagChildIds,
        });
      }
    } catch {}
  }
  redirect("/portal/learning/homework");
}

// ---- KID-47 Round 6: supplies (#9) ----
export async function createSupplyAction(formData: FormData) {
  const me = authAccount();
  await ensureSchema();
  const { createSupply, createNewsfeedPost, listChildren } = await import("@/lib/store");
  const instituteId = await requireInstitute();
  const title = String(formData.get("title") ?? "").trim();
  if (instituteId && title) {
    const quantity = Number(formData.get("quantity") ?? 1) || 1;
    const unit = String(formData.get("unit") ?? "pcs");
    const notes = String(formData.get("notes") ?? "");
    await createSupply({
      instituteId,
      title,
      quantity,
      unit,
      notes,
      accountId: me.accountId,
    });
    // Notify parents of updates via newsfeed. KID-47 fix: the parent app
    // filters the newsfeed strictly by child tags, so tag every enrolled
    // child — otherwise center-wide supply requests stay invisible to parents.
    try {
      const tagChildIds = (await listChildren(instituteId)).map((c) => String(c.id));
      if (tagChildIds.length > 0) {
        await createNewsfeedPost({
          instituteId,
          accountId: me.accountId,
          body: `Supplies needed: ${title} × ${quantity} ${unit}${notes ? ` — ${notes}` : ""}`,
          tagChildIds,
        });
      }
    } catch {}
  }
  redirect("/portal/supplies");
}

export async function updateSupplyStatusAction(formData: FormData) {
  const me = authAccount();
  await ensureSchema();
  const { updateSupplyStatus, createNewsfeedPost, listChildren } = await import("@/lib/store");
  const { queryGet } = await import("@/lib/db");
  const instituteId = await requireInstitute();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "needed");
  if (id) {
    await updateSupplyStatus(id, status);
    // KID-47 fix (#9 "parents get notified of updates"): post status changes
    // to the parent-visible (tagged) newsfeed thread.
    try {
      const supply = instituteId ? await queryGet("SELECT * FROM supply_request WHERE id = ?", id) : undefined;
      if (supply && instituteId) {
        const tagChildIds = (await listChildren(instituteId)).map((c) => String(c.id));
        if (tagChildIds.length > 0) {
          await createNewsfeedPost({
            instituteId,
            accountId: me.accountId,
            body: `Supplies update: ${String(supply.title)} is now ${status}`,
            tagChildIds,
          });
        }
      }
    } catch {}
  }
  redirect("/portal/supplies");
}

// ---- KID-47 Round 6: staff schedules (#13) ----
export async function createStaffScheduleAction(formData: FormData) {
  const me = authAccount();
  await ensureSchema();
  const { createStaffSchedule } = await import("@/lib/store");
  let staffId = String(formData.get("staffId") ?? "");
  // KID-105 #13: non-admins can only schedule themselves.
  if (!isAdminRole(me.role)) {
    const myStaffId = await staffIdForAccount(me.accountId);
    if (!myStaffId || myStaffId !== staffId) redirect("/portal/staff/schedule");
  }
  if (staffId) {
    await createStaffSchedule({
      staffId,
      dayOfWeek: Number(formData.get("dayOfWeek") ?? 1),
      startTime: String(formData.get("startTime") ?? "08:00"),
      endTime: String(formData.get("endTime") ?? "16:00"),
      notes: String(formData.get("notes") ?? ""),
    });
  }
  redirect("/portal/staff/schedule");
}

export async function deleteStaffScheduleAction(formData: FormData) {
  const me = authAccount();
  const { deleteStaffSchedule } = await import("@/lib/store");
  const id = String(formData.get("id") ?? "");
  // KID-105 #13: non-admins can only delete their own shifts.
  if (id && !isAdminRole(me.role)) {
    const myStaffId = await staffIdForAccount(me.accountId);
    const row = await queryGet("SELECT staff_id FROM staff_schedule WHERE id = ?", id);
    if (!myStaffId || !row || String(row.staff_id) !== myStaffId) redirect("/portal/staff/schedule");
  }
  if (id) await deleteStaffSchedule(id);
  redirect("/portal/staff/schedule");
}

// ---- KID-47 Round 6 / KID-107: notification prefs live on Account Settings ----
export async function saveNotificationPrefsAction(formData: FormData) {
  const me = authAccount();
  await ensureSchema();
  const { setNotificationPref, NOTIFICATION_ACTIVITIES } = await import("@/lib/store");
  for (const activity of NOTIFICATION_ACTIVITIES as readonly string[]) {
    for (const channel of ["email", "inapp"]) {
      const key = `${activity}_${channel}`;
      await setNotificationPref(me.accountId, activity, channel, formData.get(key) === "on");
    }
  }
  redirect("/portal/account?saved=1");
}

// ---- KID-47 Round 6: shareable form link (#26) ----
export async function generateFormShareLinkAction(formData: FormData) {
  authAccount();
  const { ensureFormShareToken } = await import("@/lib/store");
  const formId = String(formData.get("formId") ?? "");
  if (formId) await ensureFormShareToken(formId);
  redirect("/portal/forms");
}

// Public (no-login) parent submission via share token
export async function submitPublicFormAction(formData: FormData) {
  await ensureSchema();
  const { saveFormResponse, getFormByShareToken } = await import("@/lib/store");
  const token = String(formData.get("token") ?? "");
  const form = token ? await getFormByShareToken(token) : undefined;
  if (!form) redirect("/");
  const answers: Record<string, string> = {};
  for (let i = 0; i < 20; i++) {
    answers[`field_${i}`] = String(formData.get(`field_${i}`) ?? "").trim();
  }
  await saveFormResponse({ formId: String(form.id), answersJson: JSON.stringify(answers) });
  redirect(`/forms/f/${token}?sent=1`);
}

// ---- KID-53 part 2 ----

// Staff presence / availability status (staff profile card).
export async function logStaffStatusAction(formData: FormData) {
  const me = authAccount();
  await ensureSchema();
  const { logStaffStatus } = await import("@/lib/store");
  const staffId = String(formData.get("staffId") ?? "");
  const kind = String(formData.get("kind") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim() || undefined;
  if (staffId && kind) {
    // KID-58: staff cannot check in before the center opens (same gate as
    // children). Check-outs and other statuses are always allowed.
    if (kind === "checkin") {
      const instituteId = await firstInstituteId();
      if (instituteId) {
        const policy = await checkInAllowed(String(instituteId));
        if (!policy.allowed) {
          return { error: policy.error ?? "Check-in is not allowed at this time." };
        }
      }
    }
    await logStaffStatus({ staffId, kind, note, accountId: me.accountId });
  }
  redirect(`/portal/staff/${staffId}`);
}

// Staff profile edits (full name, role, contact, rooms, last date).
export async function updateStaffInfoAction(formData: FormData) {
  requireAdmin();
  await ensureSchema();
  const { updateStaffInfo } = await import("@/lib/store");
  const staffId = String(formData.get("staffId") ?? "");
  if (staffId) {
    await updateStaffInfo(staffId, {
      fullName: String(formData.get("fullName") ?? "").trim() || undefined,
      role: String(formData.get("role") ?? "").trim() || undefined,
      email: String(formData.get("email") ?? "").trim().toLowerCase() || undefined,
      phone: String(formData.get("phone") ?? "").trim() || undefined,
      bio: String(formData.get("bio") ?? "").trim() || undefined,
      roomIds: formData.getAll("roomIds").map(String),
      lastDate: String(formData.get("lastDate") ?? "") || null,
    });
  }
  redirect(`/portal/staff/${staffId}`);
}

// Form-response submission funnel status.
export async function setFormResponseStatusAction(formData: FormData) {
  authAccount();
  await ensureSchema();
  const { setFormResponseStatus } = await import("@/lib/store");
  const responseId = String(formData.get("responseId") ?? "");
  const status = String(formData.get("status") ?? "new");
  const formId = String(formData.get("formId") ?? "");
  if (responseId) await setFormResponseStatus(responseId, status);
  redirect(formId ? `/portal/forms?view=${formId}` : "/portal/forms");
}

// Smart-list creation (persists the list name; the builder filters live).
export async function createSmartListAction(formData: FormData) {
  const instituteId = await requireInstitute();
  const name = String(formData.get("name") ?? "").trim();
  const { createTag } = await import("@/lib/store");
  if (instituteId && name) {
    await createTag(String(instituteId), name, "#DC2626");
  }
  redirect("/portal/tags");
}

// KID-113: admin resends the activation email to an unactivated parent or
// staff account. Shown only for accounts whose email is still unconfirmed;
// activated accounts never render the affordance, and this action double-
// checks so a forged post cannot spam confirmed users. Rate-limited per
// target address and per admin, with every attempt audit-logged.
export async function resendActivationAction(formData: FormData) {
  const me = authAccount();
  if (!isAdminRole(me.role)) {
    return { error: "Only admins can resend activation emails." };
  }
  await ensureSchema();
  const {
    normalizeEmail,
    isValidEmail,
    isUnactivatedAccount,
    decideRateLimit,
    countRecentResendsForEmail,
    countRecentResendsForAdmin,
    logResendAttempt,
  } = await import("@/lib/activation");

  const email = normalizeEmail(formData.get("email"));
  if (!isValidEmail(email)) {
    return { error: "Enter a valid email address." };
  }
  const account = await findAccountByEmail(email);
  if (!account) {
    await logResendAttempt({
      targetEmail: email,
      adminAccountId: me.accountId,
      channel: "none",
      status: "no_account",
      detail: "No login account for this email yet.",
    });
    return { error: "No login account found for that email yet. Create the login first, then resend." };
  }
  if (!isUnactivatedAccount(account)) {
    await logResendAttempt({
      targetEmail: email,
      adminAccountId: me.accountId,
      channel: "none",
      status: "already_active",
      detail: "Account already activated.",
    });
    return { error: "That account is already activated." };
  }

  const [recentForEmail, recentForAdmin] = await Promise.all([
    countRecentResendsForEmail(email),
    countRecentResendsForAdmin(me.accountId),
  ]);
  const decision = decideRateLimit(recentForEmail, recentForAdmin);
  if (decision.limited) {
    await logResendAttempt({
      targetEmail: email,
      adminAccountId: me.accountId,
      channel: "supabase",
      status: "rate_limited",
      detail: decision.reason,
    });
    return { error: decision.reason };
  }

  if (!supabaseConfigured()) {
    await logResendAttempt({
      targetEmail: email,
      adminAccountId: me.accountId,
      channel: "none",
      status: "failed",
      detail: "Email provider not configured.",
    });
    return { error: "Email delivery isn't configured yet. Ask the daycare admin to share an invite code instead." };
  }

  try {
    const { error } = await getSupabase().auth.resend({ type: "signup", email });
    if (!error) {
      await logResendAttempt({
        targetEmail: email,
        adminAccountId: me.accountId,
        channel: "supabase",
        status: "sent",
      });
      return { ok: true };
    }
    console.error(`KID-113 resend: GoTrue resend failed for ${email}:`, error.message);
    // Fallback: a recovery email also reaches the GoTrue identity when the
    // signup-resend path rejects (e.g. user already exists server-side).
    const recovery = await getSupabase().auth.resetPasswordForEmail(email, {
      redirectTo: `${publicOrigin(requestOrigin())}/reset-password`,
    });
    if (!recovery.error) {
      await logResendAttempt({
        targetEmail: email,
        adminAccountId: me.accountId,
        channel: "supabase-recovery",
        status: "sent",
        detail: `signup resend failed (${error.message}); recovery email sent instead.`,
      });
      return { ok: true };
    }
    console.error(`KID-113 resend: recovery fallback failed for ${email}:`, recovery.error.message);
    // Last resort: the parent may have an app-side account but no GoTrue user
    // yet (never signed up), so both GoTrue paths reject. A pending invite can
    // still reach them through the admin-invite channel, which creates the
    // GoTrue identity. Only attempted when a pending invite exists.
    try {
      const pending = await getPendingInvitesByEmail(email);
      if (pending.length > 0) {
        const inviteResult = await sendParentInviteEmail(pending[0], {
          origin: publicOrigin(requestOrigin()),
          isResend: true,
        });
        await logResendAttempt({
          targetEmail: email,
          adminAccountId: me.accountId,
          channel: "supabase-admin-invite",
          status: inviteResult.status === "sent" ? "sent" : "failed",
          detail: `GoTrue resend+recovery failed (${recovery.error.message}); admin-invite fallback: ${inviteResult.detail}`,
        });
        if (inviteResult.status === "sent") return { ok: true };
      }
    } catch (err) {
      console.error(`KID-113 resend: admin-invite fallback failed for ${email}:`, err);
    }
    await logResendAttempt({
      targetEmail: email,
      adminAccountId: me.accountId,
      channel: "supabase",
      status: "failed",
      detail: recovery.error.message,
    });
    return { error: "We couldn't send the activation email right now. Try again in a few minutes." };
  } catch (err) {
    console.error(`KID-113 resend: unexpected failure for ${email}:`, err);
    await logResendAttempt({
      targetEmail: email,
      adminAccountId: me.accountId,
      channel: "supabase",
      status: "failed",
      detail: err instanceof Error ? err.message : String(err),
    });
    return { error: "We couldn't send the activation email right now. Try again in a few minutes." };
  }
}