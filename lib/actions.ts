"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  createAccount,
  findAccountByEmail,
  verifyPassword,
  createSessionToken,
  setPin,
  verifyToken,
  setEmailConfirmed,
  emailConfirmedFor,
} from "@/lib/auth";
import { queryGet, queryRun, ensureSchema } from "@/lib/db";
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
  addContact,
  createInvite,
  updateInstitute,
  upsertChildPlan,
  createInvoice,
  recordPayment,
  savePaymentMethod,
} from "@/lib/store";
import { supabaseConfigured, getSupabase } from "@/lib/supabase";

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
  await setSession(account.email);
  redirect(emailConfirmedFor(account) ? homeForRole(account.role) : "/welcome");
}

export async function registerAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("fullName") ?? "").trim();
  const inviteCode = String(formData.get("inviteCode") ?? "").trim();

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
  let emailConfirmed = true;
  if (supabaseConfigured()) {
    const { data, error } = await getSupabase().auth.signUp({ email, password });
    const isRateLimited = !!(
      error &&
      (error.code === "over_email_send_rate_limit" ||
        String(error.message).toLowerCase().includes("rate limit"))
    );
    if (error) {
      if (!isRateLimited) return { error: error.message };
      // Rate-limited confirmation send: keep the app session usable anyway.
      emailConfirmed = false;
    } else {
      authUserId = data.user?.id ?? null;
      // On a confirmation-gated project GoTrue only issues a session (and only
      // sets confirmed_at) once the email is verified. right after signup
      // identities is already non-empty, so it is NOT a confirmation signal.
      emailConfirmed = !!(data.session || data.user?.email_confirmed_at || data.user?.confirmed_at);
    }
  }

  const account = await createAccount({
    email,
    password,
    fullName,
    role: "parent",
    authUserId,
    emailConfirmed,
  });

  // Optional PIN
  const pin = String(formData.get("pin") ?? "").trim();
  if (pin) await setPin(account.id, pin);

  // Link via invite code if provided
  if (inviteCode) {
    const invite = await getInviteByCode(inviteCode);
    if (invite && invite.child_id) {
      await linkFamily(account.id, String(invite.child_id));
    }
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
  if (error) return { error: error.message };
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
    await linkFamily(account.id, String(invite.child_id));
    await queryRun("UPDATE invite SET status = 'accepted' WHERE id = ?", invite.id);
    return { ok: true };
  }
  return { error: "Invite has no linked child." };
}

// ---- Daily-loop actions (check-in/out, reports, newsfeed, messaging, consents, incidents) ----

function authAccount(): SessionCookie {
  const cookie = cookies().get(SESSION_COOKIE)?.value;
  if (!cookie) throw new Error("not signed in");
  return verifyToken(decodeURIComponent(cookie)) as SessionCookie;
}

async function firstInstituteId(): Promise<string> {
  const row = await queryGet("SELECT id FROM institute LIMIT 1");
  return String(row?.id ?? "");
}

export async function checkInOutAction(formData: FormData) {
  const childId = String(formData.get("childId") ?? "");
  const type = String(formData.get("type") ?? "") as "in" | "out";
  const me = authAccount();
  await checkChildInOut({ childId, accountId: me.accountId, type });
  redirect(`/child/${childId}`);
}

export async function saveDailyReportAction(formData: FormData) {
  const childId = String(formData.get("childId") ?? "");
  const reportDate = String(formData.get("reportDate") ?? "") || new Date().toISOString().slice(0, 10);
  const me = authAccount();
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
  await addComment(String(formData.get("postId") ?? ""), me.accountId, String(formData.get("body") ?? ""));
  redirect("/portal/newsfeed");
}

export async function createConsentAction(formData: FormData) {
  await ensureSchema();
  const instituteId = await firstInstituteId();
  await createConsent({
    instituteId,
    title: String(formData.get("title") ?? ""),
    body: String(formData.get("body") ?? ""),
    childId: String(formData.get("childId") ?? "") || undefined,
  });
  redirect("/portal/consents");
}

export async function respondConsentAction(formData: FormData) {
  await respondConsent(String(formData.get("id") ?? ""), String(formData.get("status") ?? "approved") as "approved" | "denied");
  redirect("/child/consents");
}

export async function createIncidentAction(formData: FormData) {
  const me = authAccount();
  await ensureSchema();
  const instituteId = await firstInstituteId();
  await createIncident({
    instituteId,
    childId: String(formData.get("childId") ?? ""),
    accountId: me.accountId,
    type: String(formData.get("type") ?? "incident"),
    description: String(formData.get("description") ?? ""),
  });
  redirect("/portal/incidents");
}

export async function acknowledgeIncidentAction(formData: FormData) {
  await acknowledgeIncident(String(formData.get("id") ?? ""));
  redirect("/child/incidents");
}

export async function addChildAction(formData: FormData) {
  await ensureSchema();
  const instituteId = await firstInstituteId();
  const child = await createChild({
    instituteId,
    firstName: String(formData.get("firstName") ?? ""),
    lastName: String(formData.get("lastName") ?? ""),
    dob: String(formData.get("dob") ?? "") || undefined,
    roomId: String(formData.get("roomId") ?? "") || undefined,
    allergies: String(formData.get("allergies") ?? ""),
  });
  redirect(`/portal/children/${child.id}`);
}

export async function addStaffAction(formData: FormData) {
  await ensureSchema();
  const instituteId = await firstInstituteId();
  await createStaff({
    instituteId,
    fullName: String(formData.get("fullName") ?? ""),
    role: String(formData.get("role") ?? "carer"),
    roomIds: formData.getAll("roomIds").map(String),
  });
  redirect("/portal/staff");
}

export async function addRoomAction(formData: FormData) {
  await ensureSchema();
  const instituteId = await firstInstituteId();
  await createRoom(String(instituteId), String(formData.get("name") ?? ""), Number(formData.get("capacity")) || undefined);
  redirect("/portal/rooms");
}

export async function addContactAction(formData: FormData) {
  await addContact({
    childId: String(formData.get("childId") ?? ""),
    fullName: String(formData.get("fullName") ?? ""),
    relationship: String(formData.get("relationship") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    email: String(formData.get("email") ?? ""),
    isPickup: formData.get("isPickup") === "on",
    isEmergency: formData.get("isEmergency") === "on",
  });
  redirect(`/portal/children/${String(formData.get("childId"))}`);
}

export async function inviteParentAction(formData: FormData) {
  await ensureSchema();
  const instituteId = await firstInstituteId();
  await createInvite(
    String(instituteId),
    String(formData.get("childId") ?? "") || null,
    String(formData.get("email") ?? ""),
    String(formData.get("code") ?? "")
  );
  redirect("/portal/children");
}

export async function saveBrandingAction(formData: FormData) {
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

// ---- Billing actions (M3 simplified billing) ----

export async function setChildPlanAction(formData: FormData) {
  const me = authAccount();
  await ensureSchema();
  const instituteId = await firstInstituteId();
  if (!instituteId) throw new Error("No daycare configured yet.");
  const { parseDollarsToCents } = await import("@/lib/money");
  const amount = parseDollarsToCents(String(formData.get("amount") ?? ""));
  await upsertChildPlan({
    instituteId,
    childId: String(formData.get("childId") ?? ""),
    planName: String(formData.get("planName") ?? "Standard"),
    amountCents: amount,
    billingPeriod: String(formData.get("billingPeriod") ?? "monthly"),
    updatedByAccountId: me.accountId,
  });
  redirect("/portal/billing");
}

export async function createInvoiceAction(formData: FormData) {
  const me = authAccount();
  await ensureSchema();
  const instituteId = await firstInstituteId();
  if (!instituteId) throw new Error("No daycare configured yet.");
  const { parseDollarsToCents } = await import("@/lib/money");
  const amount = parseDollarsToCents(String(formData.get("amount") ?? ""));
  await createInvoice({
    instituteId,
    childId: String(formData.get("childId") ?? ""),
    description: String(formData.get("description") ?? ""),
    amountCents: amount,
    dueDate: String(formData.get("dueDate") ?? "") || undefined,
    createdByAccountId: me.accountId,
  });
  redirect("/portal/billing/invoices");
}

export async function recordPaymentAction(formData: FormData) {
  const me = authAccount();
  await ensureSchema();
  const instituteId = await firstInstituteId();
  if (!instituteId) throw new Error("No daycare configured yet.");
  const { parseDollarsToCents } = await import("@/lib/money");
  const amount = parseDollarsToCents(String(formData.get("amount") ?? ""));
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const { getInvoice } = await import("@/lib/store");
  const invoice = await getInvoice(invoiceId);
  if (!invoice) throw new Error("Invoice not found.");
  await recordPayment({
    instituteId,
    invoiceId,
    accountId: me.accountId,
    method: String(formData.get("method") ?? "other"),
    reference: String(formData.get("reference") ?? "") || undefined,
    amountCents: amount,
    paidAt: String(formData.get("paidAt") ?? "") || undefined,
  });
  const origin = String(formData.get("origin") ?? "portal");
  redirect(origin === "child" ? "/child/billing" : "/portal/billing/invoices");
}

export async function savePaymentMethodAction(formData: FormData) {
  const me = authAccount();
  await ensureSchema();
  await savePaymentMethod({
    accountId: me.accountId,
    label: String(formData.get("label") ?? "Card"),
    provider: String(formData.get("provider") ?? "") || undefined,
    last4: String(formData.get("last4") ?? "") || undefined,
    isDefault: formData.get("isDefault") === "on",
  });
  redirect("/child/billing");
}

export async function voidInvoiceAction(formData: FormData) {
  await ensureSchema();
  const { setInvoiceVoid } = await import("@/lib/store");
  await setInvoiceVoid(String(formData.get("invoiceId") ?? ""));
  redirect("/portal/billing/invoices");
}