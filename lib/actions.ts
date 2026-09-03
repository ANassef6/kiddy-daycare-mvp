"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  createAccount,
  findAccountByEmail,
  verifyPassword,
  createSessionToken,
  setPin,
} from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getInviteByCode, linkFamily } from "@/lib/store";

const SESSION_COOKIE = "kiddy_sess";

function setSession(email: string) {
  const account = findAccountByEmail(email);
  if (!account) throw new Error("account not found");
  const token = createSessionToken({
    accountId: account.id,
    role: account.role,
    email: account.email,
  });
  cookies().set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 24 * 3600,
  });
  return account;
}

export async function loginAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const account = findAccountByEmail(email);
  if (!account || !verifyPassword(password, account.password_hash)) {
    return { error: "Invalid email or password." };
  }
  setSession(account.email);
  redirect(account.role === "parent" ? "/child" : "/portal/dashboard");
}

export async function registerAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("fullName") ?? "").trim();
  const inviteCode = String(formData.get("inviteCode") ?? "").trim();

  if (findAccountByEmail(email)) {
    return { error: "An account with that email already exists." };
  }
  const account = createAccount({ email, password, fullName, role: "parent" });

  // Optional PIN
  const pin = String(formData.get("pin") ?? "").trim();
  if (pin) setPin(account.id, pin);

  // Link via invite code if provided
  if (inviteCode) {
    const invite = getInviteByCode(inviteCode);
    if (invite && invite.child_id) {
      linkFamily(account.id, String(invite.child_id));
    }
  }

  setSession(account.email);
  redirect("/child");
}

export async function logoutAction() {
  cookies().set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  redirect("/");
}

export async function linkInviteAction(formData: FormData) {
  const code = String(formData.get("inviteCode") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const account = findAccountByEmail(email);
  if (!account) return { error: "Account not found. Sign in first." };
  const invite = getInviteByCode(code);
  if (!invite) return { error: "Invite code not found." };
  if (invite.child_id) {
    linkFamily(account.id, String(invite.child_id));
    getDb()
      .prepare("UPDATE invite SET status = 'accepted' WHERE id = ?")
      .run(invite.id);
    return { ok: true };
  }
  return { error: "Invite has no linked child." };
}

// ---- Daily-loop actions (check-in/out, reports, newsfeed, messaging, consents, incidents) ----

function authAccount() {
  const cookie = cookies().get(SESSION_COOKIE)?.value;
  if (!cookie) throw new Error("not signed in");
  const { verifyToken } = require("@/lib/auth");
  return verifyToken(decodeURIComponent(cookie)) as {
    accountId: string;
    role: string;
    email: string;
  };
}

export async function checkInOutAction(formData: FormData) {
  const { checkChildInOut } = require("@/lib/store");
  const childId = String(formData.get("childId") ?? "");
  const type = String(formData.get("type") ?? "") as "in" | "out";
  const me = authAccount();
  checkChildInOut({ childId, accountId: me.accountId, type });
  redirect(`/child/${childId}`);
}

export async function saveDailyReportAction(formData: FormData) {
  const { upsertDailyReport } = require("@/lib/store");
  const childId = String(formData.get("childId") ?? "");
  const reportDate = String(formData.get("reportDate") ?? "") || new Date().toISOString().slice(0, 10);
  const me = authAccount();
  upsertDailyReport({
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
  const { createNewsfeedPost } = require("@/lib/store");
  const me = authAccount();
  const roles = { account: me } as never;
  const institute = getDb()
    .prepare("SELECT institute_id FROM staff WHERE id = ?")
    .get() as { institute_id: string } | undefined;
  const instituteId =
    institute?.institute_id ??
    (getDb().prepare("SELECT id FROM institute LIMIT 1").get() as { id: string } | undefined)?.id ??
    "";
  createNewsfeedPost({
    instituteId: String(instituteId),
    accountId: me.accountId,
    body: String(formData.get("body") ?? ""),
    tagChildIds: formData.getAll("childIds").map(String),
  });
  redirect("/portal/newsfeed");
}

export async function commentAction(formData: FormData) {
  const { addComment } = require("@/lib/store");
  const me = authAccount();
  addComment(
    String(formData.get("postId") ?? ""),
    me.accountId,
    String(formData.get("body") ?? "")
  );
  redirect("/portal/newsfeed");
}

export async function createConsentAction(formData: FormData) {
  const { createConsent } = require("@/lib/store");
  const institute = getDb().prepare("SELECT id FROM institute LIMIT 1").get() as { id: string } | undefined;
  createConsent({
    instituteId: String(institute?.id ?? ""),
    title: String(formData.get("title") ?? ""),
    body: String(formData.get("body") ?? ""),
    childId: String(formData.get("childId") ?? "") || undefined,
  });
  redirect("/portal/consents");
}

export async function respondConsentAction(formData: FormData) {
  const { respondConsent } = require("@/lib/store");
  respondConsent(String(formData.get("id") ?? ""), String(formData.get("status") ?? "approved") as "approved" | "denied");
  redirect("/child/consents");
}

export async function createIncidentAction(formData: FormData) {
  const { createIncident } = require("@/lib/store");
  const me = authAccount();
  const institute = getDb().prepare("SELECT id FROM institute LIMIT 1").get() as { id: string } | undefined;
  createIncident({
    instituteId: String(institute?.id ?? ""),
    childId: String(formData.get("childId") ?? ""),
    accountId: me.accountId,
    type: String(formData.get("type") ?? "incident"),
    description: String(formData.get("description") ?? ""),
  });
  redirect("/portal/incidents");
}

export async function acknowledgeIncidentAction(formData: FormData) {
  const { acknowledgeIncident } = require("@/lib/store");
  acknowledgeIncident(String(formData.get("id") ?? ""));
  redirect("/child/incidents");
}

export async function addChildAction(formData: FormData) {
  const { createChild } = require("@/lib/store");
  const me = authAccount();
  const institute = getDb().prepare("SELECT id FROM institute LIMIT 1").get() as { id: string } | undefined;
  const child = createChild({
    instituteId: String(institute?.id ?? ""),
    firstName: String(formData.get("firstName") ?? ""),
    lastName: String(formData.get("lastName") ?? ""),
    dob: String(formData.get("dob") ?? "") || undefined,
    roomId: String(formData.get("roomId") ?? "") || undefined,
    allergies: String(formData.get("allergies") ?? ""),
  });
  redirect(`/portal/children/${child.id}`);
}

export async function addStaffAction(formData: FormData) {
  const { createStaff } = require("@/lib/store");
  const institute = getDb().prepare("SELECT id FROM institute LIMIT 1").get() as { id: string } | undefined;
  createStaff({
    instituteId: String(institute?.id ?? ""),
    fullName: String(formData.get("fullName") ?? ""),
    role: String(formData.get("role") ?? "carer"),
    roomIds: formData.getAll("roomIds").map(String),
  });
  redirect("/portal/staff");
}

export async function addRoomAction(formData: FormData) {
  const { createRoom } = require("@/lib/store");
  const institute = getDb().prepare("SELECT id FROM institute LIMIT 1").get() as { id: string } | undefined;
  createRoom(String(institute?.id ?? ""), String(formData.get("name") ?? ""), Number(formData.get("capacity")) || undefined);
  redirect("/portal/rooms");
}

export async function addContactAction(formData: FormData) {
  const { addContact } = require("@/lib/store");
  addContact({
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
  const { createInvite } = require("@/lib/store");
  const institute = getDb().prepare("SELECT id FROM institute LIMIT 1").get() as { id: string } | undefined;
  createInvite(
    String(institute?.id ?? ""),
    String(formData.get("childId") ?? "") || null,
    String(formData.get("email") ?? ""),
    String(formData.get("code") ?? "")
  );
  redirect("/portal/children");
}

export async function saveBrandingAction(formData: FormData) {
  const { updateInstitute } = require("@/lib/store");
  const institute = getDb().prepare("SELECT id FROM institute LIMIT 1").get() as { id: string } | undefined;
  if (institute) {
    updateInstitute(String(institute.id), {
      name: String(formData.get("name") ?? ""),
      primary_color: String(formData.get("primaryColor") ?? "#3B82F6"),
      accent_color: String(formData.get("accentColor") ?? "#10B981"),
      font: String(formData.get("font") ?? "Inter"),
    });
  }
  redirect("/portal/settings");
}
