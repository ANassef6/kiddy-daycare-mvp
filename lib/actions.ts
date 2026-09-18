"use server";

import { cookies, headers } from "next/headers";
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

  // Parents cannot create accounts on their own — the daycare invites them.
  // A valid, still-pending invite code is required to activate an account.
  if (!inviteCode) {
    return { error: "Your daycare must invite you first. Ask them for an invite code." };
  }
  const invite = await getInviteByCode(inviteCode);
  if (!invite) {
    return { error: "That invite code wasn't found. Check the code your daycare sent you." };
  }
  if (String(invite.status ?? "pending") !== "pending") {
    return { error: "That invite code has already been used. Ask your daycare for a new one." };
  }

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

  // Link via the invite the daycare issued and consume it.
  if (invite.child_id) {
    await linkFamily(account.id, String(invite.child_id));
  }
  await queryRun("UPDATE invite SET status = 'accepted' WHERE id = ?", invite.id);

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

function requestOrigin(): string {
  const h = headers();
  const host = h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  if (!host) return "";
  return `${proto}://${host}`;
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
    redirectTo: `${requestOrigin()}/reset-password`,
  });
  if (error) {
    // Supabase rejects non-routable addresses (e.g. the seeded *.test demo
    // accounts) with a generic error. Point the user at the interim path.
    return {
      error:
        "We couldn't send a reset link to that address. If you're a parent or staff member, ask your daycare admin to re-invite you or set a new password.",
    };
  }
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
  const session = verifyToken(decodeURIComponent(cookie)) as SessionCookie | null;
  if (!session?.accountId) throw new Error("not signed in");
  return session;
}

async function firstInstituteId(): Promise<string> {
  const row = await queryGet("SELECT id FROM institute LIMIT 1");
  return String(row?.id ?? "");
}

export async function checkInOutAction(formData: FormData) {
  const childId = String(formData.get("childId") ?? "");
  const type = String(formData.get("type") ?? "") as "in" | "out";
  const me = authAccount();
  if (childId && (type === "in" || type === "out")) {
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
  redirect(formData.get("fromParent") === "1" ? "/child/newsfeed" : "/portal/newsfeed");
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

  const child = await createChild({
    instituteId,
    firstName: String(formData.get("firstName") ?? ""),
    lastName: String(formData.get("lastName") ?? ""),
    dob: String(formData.get("dob") ?? "") || undefined,
    roomId: String(formData.get("roomId") ?? "") || undefined,
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
        await getSupabase().auth.signUp({ email, password });
      } catch {
        /* non-fatal: the app-side account still works */
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

export async function saveCenterDetailsAction(formData: FormData) {
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
  }
  redirect("/portal/events");
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
  redirect("/portal/forms");
}

export async function submitFormAction(formData: FormData) {
  const me = authAccount();
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
  const childId = String(formData.get("childId") ?? "");
  if (childId) {
    await setChildTags(childId, formData.getAll("tagIds").map(String));
  }
  redirect(`/portal/children/${childId}`);
}

export async function addDriveFileAction(formData: FormData) {
  const me = authAccount();
  const instituteId = await requireInstitute();
  if (instituteId) {
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
        childId: String(formData.get("childId") ?? "") || undefined,
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
    recordedAt: String(formData.get("recordedAt") ?? "") || undefined,
  });
  redirect("/portal/learning");
}

export async function createSupportTicketAction(formData: FormData) {
  const me = authAccount();
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
    await sendMessage({ instituteId, senderAccountId: me.accountId, recipientAccountId: recipient, body });
  }
  redirect(`/portal/messages?with=${recipient}`);
}

export async function sendParentMessageAction(formData: FormData) {
  const me = authAccount();
  const recipient = String(formData.get("recipientId") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  await ensureSchema();
  const instituteId = await firstInstituteId();
  if (recipient && body && instituteId) {
    await sendMessage({ instituteId, senderAccountId: me.accountId, recipientAccountId: recipient, body });
  }
  redirect("/child/messages");
}

// ---- #1 Logo / branding image upload ----
export async function uploadBrandingImageAction(formData: FormData) {
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
  const entityType = String(formData.get("entityType") ?? ""); // "child" | "staff"
  const entityId = String(formData.get("entityId") ?? "");
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0 || !entityType || !entityId) {
    redirect(entityType === "child" ? "/portal/children" : "/portal/staff");
  }

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

// ---- #4b Admin child billing ----
export async function addChildBillingAction(formData: FormData) {
  await ensureSchema();
  const instituteId = await firstInstituteId();
  const childId = String(formData.get("childId") ?? "");
  if (!instituteId || !childId) redirect("/portal/children");
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
  const billingId = String(formData.get("billingId") ?? "");
  const status = String(formData.get("status") ?? "pending");
  const childId = String(formData.get("childId") ?? "");
  if (billingId) {
    await updateChildBilling(billingId, { status });
  }
  redirect(`/portal/children/${childId}/billing`);
}

// ---- #8 Newsfeed likes (client calls this) ----
export async function toggleLikeAction(formData: FormData) {
  const me = authAccount();
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
  const tagChildIds = formData.getAll("childIds").map(String).filter(Boolean);
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
        : (await listChildren(instituteId)).map((c) => String(c.id));
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
  authAccount();
  await ensureSchema();
  const { createStaffSchedule } = await import("@/lib/store");
  const staffId = String(formData.get("staffId") ?? "");
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
  authAccount();
  const { deleteStaffSchedule } = await import("@/lib/store");
  const id = String(formData.get("id") ?? "");
  if (id) await deleteStaffSchedule(id);
  redirect("/portal/staff/schedule");
}

// ---- KID-47 Round 6: notification prefs (#28) ----
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
  redirect("/portal/notifications?saved=1");
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