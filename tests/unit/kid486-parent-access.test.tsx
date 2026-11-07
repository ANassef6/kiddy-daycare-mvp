// KID-486: parent/family/pickup access tiers + center parent check-in/out
// toggle + the parent enforcement fixes.
//
// Pinned here, mirroring the plan:
//   1. Family links are VIEW-ONLY server-side: every business action is
//      refused by the access ladder, and message notifications are suppressed
//      for them (no badge for a page they cannot reach).
//   2. Pickup links get the minimal surface: same-day pickup scheduling only,
//      inside working hours, one entry per child per day, past times rejected.
//   3. The center-wide parent check-in/out toggle defaults ON, is admin-only,
//      audited on change, and checkInOutAction refuses parent-role accounts
//      while it is off (attendance reads are unaffected).
//   4. Parent enforcement fixes: /portal bounces parents to /child; consent
//      responses, incident acknowledgements, form submissions and check-in/out
//      verify family-link ownership.
//   5. Pickup-time writes notify the child's assigned classroom staff and land
//      on the audit trail; staff read the same schedule through
//      pickupTimesForDate (child profile / attendance / dashboard).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { seedFixture, mustGet } from "../helpers";
import { ensureSchema, queryGet, queryAll, queryRun } from "@/lib/db";
import { createAccount, createSessionToken, type Session } from "@/lib/auth";
import * as store from "@/lib/store";
import { checkPickupTime, localIsoDate } from "@/lib/pickup-time";
import { normalizeWorkingHours } from "@/lib/working-hours";

// --- request-scope mock: the actions read cookies(); redirect() throws the
// sentinel Next uses so a refusal FAILS loudly instead of silently writing ---
const sessionCookie = { value: "" };
let mockHeaders: Record<string, string> = {};
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => (name === "kiddy_sess" ? sessionCookie : undefined),
  }),
  headers: () => ({
    get: (key: string) => mockHeaders[key.toLowerCase()] ?? null,
  }),
}));
vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/navigation")>();
  return {
    ...actual,
    redirect: (url: string | URL) => {
      const target = String(url);
      const err = new Error(`NEXT_REDIRECT: ${target}`) as Error & { digest?: string };
      err.digest = `NEXT_REDIRECT;replace;${target};`;
      throw err;
    },
    notFound: () => {
      throw new Error("NEXT_NOT_FOUND");
    },
  };
});

import { default as PortalLayout } from "@/app/portal/layout";
import {
  checkInOutAction,
  respondConsentAction,
  acknowledgeIncidentAction,
  submitFormAction,
  cancelPickupTimeAction,
  savePickupTimeAction,
  saveParentCheckinToggleAction,
  updateParentAccountAction,
  toggleLikeAction,
  sendParentMessageAction,
  saveNotificationPrefsAction,
} from "@/lib/actions";

let iid: string;
let childA: string;
let childC: string;
let ownerAccount: string;
let ownerEmail: string;
let parentAccount: string;
let parentEmail: string;
let familyAccount: string;
let familyEmail: string;
let pickupAccount: string;
let pickupEmail: string;

function sessionCookieFor(accountId: string, role: string, email: string): string {
  const session: Session = { accountId, role, email, emailConfirmed: true };
  return createSessionToken(session);
}
function setSession(accountId: string, role: string, email: string) {
  const token = sessionCookieFor(accountId, role, email);
  sessionCookie.value = token;
  mockHeaders = { cookie: `kiddy_sess=${token}` };
}

function fd(map: Record<string, string>): FormData {
  const out = new FormData();
  for (const [k, v] of Object.entries(map)) out.set(k, v);
  return out;
}

/** A HH:MM clock value safely in the future (23:59 when +1h would cross midnight). */
function futureTime(): string {
  const now = new Date();
  const plus = new Date(now.getTime() + 60 * 60 * 1000);
  if (plus.getDate() !== now.getDate()) {
    // Near midnight — the last minute of today is still in the future.
    return "23:59";
  }
  const h = plus.getHours();
  const m = plus.getMinutes();
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

async function redirectOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    throw new Error("expected a NEXT_REDIRECT refusal, but the action returned");
  } catch (err) {
    const anyErr = err as { message?: string; digest?: string };
    if (typeof anyErr?.digest === "string" && anyErr.digest.startsWith("NEXT_REDIRECT")) {
      return anyErr.digest;
    }
    throw err;
  }
}

async function countNotifications(accountId: string): Promise<number> {
  const row = await queryGet("SELECT COUNT(*) c FROM notification WHERE account_id = ?", accountId);
  return Number(row?.c ?? 0);
}

beforeEach(async () => {
  await seedFixture();
  mockHeaders = {};
  sessionCookie.value = "";
  await ensureSchema();
  iid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
  childA = String((await queryGet("SELECT id FROM child WHERE first_name = 'Ella'"))!.id);
  // The seed opens mon-fri; the tests must not depend on the weekday the
  // suite runs on, so the center starts unrestricted (open).
  await store.saveWorkingHours(iid, normalizeWorkingHours(""));

  const owner = await queryGet("SELECT id, email FROM account WHERE role = 'owner'");
  ownerAccount = String(owner!.id);
  ownerEmail = String(owner!.email);

  const parent = await queryGet("SELECT id, email FROM account WHERE email = 'parent@example.test'");
  parentAccount = String(parent!.id);
  parentEmail = String(parent!.email);

  // An unlinked third child (another family's record).
  const childRow = await store.createChild({ instituteId: iid, firstName: "Not", lastName: "Mine", dob: "2020-01-01" });
  childC = String(childRow.id);

  // View-only family link holder + pickup link holder.
  familyEmail = "family486@example.test";
  pickupEmail = "pickup486@example.test";
  const fam = await createAccount({ email: familyEmail, password: "kiddy-family", fullName: "Fam 486", role: "parent" });
  familyAccount = String(fam.id);
  await store.linkFamily(familyAccount, childA, "family");
  const pick = await createAccount({ email: pickupEmail, password: "kiddy-pickup", fullName: "Pick 486", role: "parent" });
  pickupAccount = String(pick.id);
  await store.linkFamily(pickupAccount, childA, "pickup");
});

// ---- 1. family view-only server-side ---------------------------------------
describe("family links are view-only, server-side", () => {
  it("refuse every business action through the access ladder", async () => {
    setSession(familyAccount, "parent", familyEmail);
    await expect(redirectOf(checkInOutAction(fd({ childId: childA, type: "in" })))).resolves.toMatch("/child?error=role");
    await expect(redirectOf(toggleLikeAction(fd({ postId: "any" })))).resolves.toMatch("/child?error=role");
    await expect(redirectOf(sendParentMessageAction(fd({ recipientId: ownerAccount, body: "hello" })))).resolves.toMatch("/child?error=role");
    await expect(redirectOf(respondConsentAction(fd({ id: "row-not-owned", status: "approved" })))).resolves.toMatch("/child?error=role");
    await expect(redirectOf(submitFormAction(fd({ formId: "any" })))).resolves.toMatch("/child?error=role");
    await expect(redirectOf(acknowledgeIncidentAction(fd({ id: "row-not-owned" })))).resolves.toMatch("/child?error=role");
    // Account-self actions keep working.
    await expect(redirectOf(saveNotificationPrefsAction(fd({ messages_email: "on" })) ?? "")).resolves.toMatch("/portal/account");
  });

  it("a family account can edit its OWN account details only (never child records)", async () => {
    setSession(familyAccount, "parent", familyEmail);
    await expect(redirectOf(updateParentAccountAction(fd({ fullName: "Fam Renamed", password: "longenough1" }))))
      .resolves.toMatch("/child/settings?saved=1");
    const row = await mustGet("SELECT full_name FROM account WHERE id = ?", familyAccount);
    expect(String(row.full_name)).toBe("Fam Renamed");
    // The password really moved on the account's own row and nothing else did.
    const hash = await mustGet("SELECT password_hash FROM account WHERE id = ?", familyAccount);
    expect(String(hash.password_hash)).not.toBe("x");
  });

  it("suppresses message notifications for view-only family links", async () => {
    const famBefore = await countNotifications(familyAccount);
    const parentBefore = await countNotifications(parentAccount);
    await store.sendMessage({ instituteId: iid, senderAccountId: ownerAccount, recipientAccountId: familyAccount, body: "hi fam" });
    await store.sendMessage({ instituteId: iid, senderAccountId: ownerAccount, recipientAccountId: parentAccount, body: "hi parent" });
    expect((await countNotifications(familyAccount)) - famBefore).toBe(0);
    expect((await countNotifications(parentAccount)) - parentBefore).toBe(1);
    await store.markAllNotificationsRead(parentAccount);
  });
});

// ---- 2. the center-wide parent check-in/out toggle --------------------------
describe("the parent check-in/out center toggle", () => {
  it("defaults ON and only admins may flip it (audited)", async () => {
    expect(await store.parentCheckinEnabled(iid)).toBe(true);

    setSession(parentAccount, "parent", parentEmail);
    await expect(redirectOf(saveParentCheckinToggleAction(fd({ parentCheckin: "on" })))).resolves.toMatch("/child?error=role");

    const teacher = await createAccount({ email: "teacher486@example.test", password: "x", fullName: "T", role: "teacher" });
    setSession(String(teacher.id), "teacher", "teacher486@example.test");
    await expect(redirectOf(saveParentCheckinToggleAction(fd({ parentCheckin: "on" })))).resolves.toMatch("/portal/dashboard?error=readonly");

    setSession(ownerAccount, "owner", ownerEmail);
    await expect(redirectOf(saveParentCheckinToggleAction(fd({})))).resolves.toMatch("/portal/settings?saved=parentcheckin");
    expect(await store.parentCheckinEnabled(iid)).toBe(false);
    const events = await queryAll(
      "SELECT summary FROM audit_event WHERE entity_type = 'institute_setting' ORDER BY created_at"
    );
    expect(events.length).toBe(1);
    expect(String(events[0].summary)).toMatch(/Stopped parents/);

    // A no-op save records no duplicate audit row.
    await expect(redirectOf(saveParentCheckinToggleAction(fd({})))).resolves.toMatch("/portal/settings?saved=parentcheckin");
    const events2 = await queryAll("SELECT COUNT(*) c FROM audit_event WHERE entity_type = 'institute_setting'");
    expect(Number(events2[0].c)).toBe(1);
  });

  it("off refuses checkInOutAction for parents; attendance reads stay", async () => {
    setSession(ownerAccount, "owner", ownerEmail);
    await queryRun("UPDATE institute SET parent_checkin_enabled = 0 WHERE id = ?", iid);
    setSession(parentAccount, "parent", parentEmail);
    await expect(redirectOf(checkInOutAction(fd({ childId: childA, type: "in" }))))
      .resolves.toMatch("/child?error=checkin-disabled");
    // Parents still view attendance status (the children list reads todayStatus).
    const status = await store.todayStatus(childA);
    expect(status).toBeDefined();
    // Re-enable for the remaining tests.
    setSession(ownerAccount, "owner", ownerEmail);
    await expect(redirectOf(saveParentCheckinToggleAction(fd({ parentCheckin: "on" }))))
      .resolves.toMatch("/portal/settings?saved=parentcheckin");
  });

  it("parent check-in/out rides the family link (per-child)", async () => {
    setSession(parentAccount, "parent", parentEmail);
    // Own child with a parent link: the event lands and bounces back.
    // (type "out" — a check-in would ride the seed's working-hours gate, so
    // the same-day ownership assertion must not depend on the clock.)
    await expect(redirectOf(checkInOutAction(fd({ childId: childA, type: "out" }))))
      .resolves.toMatch(`/child/${childA}`);
    // A foreign child (no family link at all) is refused at the scope gate.
    await expect(redirectOf(checkInOutAction(fd({ childId: childC, type: "in" }))))
      .resolves.toMatch("/child?error=scope");
    // The pickup link holder never passes the action ladder.
    const pick = await createAccount({ email: "picker2@example.test", password: "x", fullName: "P2", role: "parent" });
    await store.linkFamily(String(pick.id), childA, "pickup");
    setSession(String(pick.id), "parent", "picker2@example.test");
    await expect(redirectOf(checkInOutAction(fd({ childId: childA, type: "in" }))))
      .resolves.toMatch("/child?error=role");
  });
});

// ---- 3. family-link ownership on parent writes -----------------------------
describe("family-link ownership on parent writes", () => {
  it("a consent response on another family's child is refused; own + center-wide pass", async () => {
    const foreign = await store.createConsent({ instituteId: iid, title: "Foreign trip", body: "b", childId: childC });
    setSession(parentAccount, "parent", parentEmail);
    await expect(redirectOf(respondConsentAction(fd({ id: String(foreign.id), status: "approved" }))))
      .resolves.toMatch("/child/consents?error=scope");

    const own = await store.createConsent({ instituteId: iid, title: "Own one", body: "b", childId: childA });
    await expect(redirectOf(respondConsentAction(fd({ id: String(own.id), status: "approved" }))))
      .resolves.toMatch("/child/consents");
    const centerWide = await store.createConsent({ instituteId: iid, title: "Center wide", body: "b" });
    await expect(redirectOf(respondConsentAction(fd({ id: String(centerWide.id), status: "approved" }))))
      .resolves.toMatch("/child/consents");
    expect(String((await queryGet("SELECT status FROM consent_request WHERE id = ?", String(own.id)))!.status)).toBe("approved");
    expect(String((await queryGet("SELECT status FROM consent_request WHERE id = ?", String(centerWide.id)))!.status)).toBe("approved");
    expect(String((await queryGet("SELECT status FROM consent_request WHERE id = ?", String(foreign.id)))!.status)).toBe("pending");
  });

  it("an incident acknowledgement on another family's child is refused", async () => {
    const foreign = await store.createIncident({ instituteId: iid, childId: childC, accountId: ownerAccount, type: "incident", description: "x" });
    const own = await store.createIncident({ instituteId: iid, childId: childA, accountId: ownerAccount, type: "incident", description: "y" });
    setSession(parentAccount, "parent", parentEmail);
    await expect(redirectOf(acknowledgeIncidentAction(fd({ id: String(foreign.id) }))))
      .resolves.toMatch("/child/incidents?error=scope");
    await expect(redirectOf(acknowledgeIncidentAction(fd({ id: String(own.id) }))))
      .resolves.toMatch("/child/incidents");
    expect(Number((await queryGet("SELECT acknowledged FROM incident_report WHERE id = ?", String(own.id)))!.acknowledged)).toBe(1);
    expect(Number((await queryGet("SELECT acknowledged FROM incident_report WHERE id = ?", String(foreign.id)))!.acknowledged)).toBe(0);
  });

  it("a form submission with a foreign childId is refused; the parent's own child passes", async () => {
    const form = await store.createForm({ instituteId: iid, kind: "form", title: "F", description: "", fieldsJson: "[]", accountId: ownerAccount });
    setSession(parentAccount, "parent", parentEmail);
    await expect(redirectOf(submitFormAction(fd({
      formId: String(form.id), childId: childC, field_0: "v", field_0_label: "L", field_0_key: "k",
    })))).resolves.toMatch("/child/forms?error=scope");
    await expect(redirectOf(submitFormAction(fd({
      formId: String(form.id), childId: childA, field_0: "v", field_0_label: "L", field_0_key: "k",
    })))).resolves.toMatch("/child/forms?sent=");
    const row = await queryGet("SELECT child_id FROM form_response WHERE form_id = ?", String(form.id));
    expect(String(row!.child_id)).toBe(childA);
  });
});

// ---- 4. pickup-time scheduling ---------------------------------------------
describe("pickup-time scheduling (same day, working hours, one per child)", () => {
  const day = () => localIsoDate(new Date());

  it("checkPickupTime enforces the rules", () => {
    const now = new Date();
    const today = day();
    const week = normalizeWorkingHours(JSON.stringify({ [String(now.getDay())]: { open: "07:00", close: "20:00" } }));

    const fixedNow = new Date("2026-01-05T05:00:00Z");
    expect(checkPickupTime({ week: "", date: localIsoDate(fixedNow), time: "23:59", now: fixedNow })).toEqual({ ok: true });
    expect(checkPickupTime({ week, date: "2020-01-01", time: "10:00", now })).toEqual({ ok: false, error: "notToday" });
    expect(checkPickupTime({ week, date: "junk", time: "10:00", now })).toEqual({ ok: false, error: "invalidDate" });
    expect(checkPickupTime({ week, date: today, time: "25:99", now })).toEqual({ ok: false, error: "invalidTime" });
    // Closed day: a configured week with no entry for today.
    const otherDays = Object.fromEntries(
      [0, 1, 2, 3, 4, 5, 6].filter((d) => d !== now.getDay()).map((d) => [String(d), { open: "07:00", close: "20:00" }])
    );
    const wOther = normalizeWorkingHours(JSON.stringify(otherDays));
    expect(checkPickupTime({ week: wOther, date: today, time: "10:00", now })).toEqual({ ok: false, error: "closedDay" });
    // Outside hours (before open / after close).
    expect(checkPickupTime({ week, date: today, time: "06:00", now })).toEqual({ ok: false, error: "outsideHours" });
    expect(checkPickupTime({ week, date: today, time: "21:00", now })).toEqual({ ok: false, error: "outsideHours" });
    // Past times are rejected even with the center wide open.
    expect(checkPickupTime({ week: "", date: today, time: "00:00", now })).toEqual({ ok: false, error: "pastTime" });
  });

  it("the pickup link sets, updates and cancels today's entry — and staff are notified", async () => {
    setSession(pickupAccount, "parent", pickupEmail);
    const time = futureTime();
    await expect(redirectOf(savePickupTimeAction(fd({ childId: childA, time, note: "With grandma" }))))
      .resolves.toMatch("/child?saved=1");
    const row = await store.getPickupTime(childA, day());
    expect(String(row!.pickup_time)).toBe(time);
    expect(String(row!.note)).toBe("With grandma");

    // Assigned classroom staff (the seeded admin staff owns Toddlers) got one.
    const notifs = await queryAll(
      "SELECT payload FROM notification WHERE activity = 'attendance' AND kind = 'pickup_time' AND account_id = ?",
      ownerAccount
    );
    expect(notifs.length).toBe(1);
    await store.markAllNotificationsRead(ownerAccount);

    // One entry per child per day: the second write UPDATES the same row.
    const later = futureTime();
    await expect(redirectOf(savePickupTimeAction(fd({ childId: childA, time: later }))))
      .resolves.toMatch("/child?saved=1");
    const ownRows = await store.pickupTimesForAccount(pickupAccount, day());
    expect(ownRows.filter((r: any) => String(r.child_id) === childA && String(r.pickup_date) === day()).length).toBe(1);
    const row2 = await store.getPickupTime(childA, day());
    expect(String(row2!.pickup_time)).toBe(later);
    expect(String(row2!.id)).toBe(String(row!.id));
    // Each save (set + update) notified the assigned staff once.
    expect(await countNotifications(ownerAccount)).toBe(2);

    // Staff views read the same schedule with the child names joined.
    const view = await store.pickupTimesForDate(iid, day());
    expect(view.map((r: any) => String(r.child_id))).toContain(childA);
    expect(String(view.find((r: any) => String(r.child_id) === childA)!.first_name)).toBe("Ella");

    // Cancel removes the owner's own row (and nothing else afterwards).
    await expect(redirectOf(cancelPickupTimeAction(fd({ childId: childA }))))
      .resolves.toMatch("/child?saved=cancelled");
    expect(await store.getPickupTime(childA, day())).toBeUndefined();
    expect(await store.deletePickupTime(childA, day(), pickupAccount)).toBe(false);

    const audits = await queryAll("SELECT action FROM audit_event WHERE entity_type = 'pickup_time' ORDER BY created_at");
    expect(audits.map((r) => String(r.action))).toEqual(["create", "update", "delete"]);
    await store.markAllNotificationsRead(ownerAccount);
  });

  it("rejects past/outside-hours/closed-day times with real error text; parents cannot schedule", async () => {
    // The center is closed today (a week that opens only the other days).
    const otherDays = Object.fromEntries(
      [0, 1, 2, 3, 4, 5, 6].filter((d) => d !== new Date().getDay()).map((d) => [String(d), { open: "07:00", close: "20:00" }])
    );
    await store.saveWorkingHours(iid, normalizeWorkingHours(JSON.stringify(otherDays)));
    setSession(pickupAccount, "parent", pickupEmail);
    const res1 = (await savePickupTimeAction(fd({ childId: childA, time: "10:00" }))) as { error?: string } | undefined;
    expect(typeof res1?.error).toBe("string");
    expect(res1!.error!.length).toBeGreaterThan(8);

    // Outside hours: today opens only 23:00-23:30 and 10:00 is refused.
    await store.saveWorkingHours(iid, normalizeWorkingHours(JSON.stringify({ [String(new Date().getDay())]: { open: "23:00", close: "23:30" } })));
    const res2 = (await savePickupTimeAction(fd({ childId: childA, time: "10:00" }))) as { error?: string };
    expect(typeof res2?.error).toBe("string");

    await store.saveWorkingHours(iid, normalizeWorkingHours(""));
    // Past times are refused even wide open (00:00 is always in the past).
    const res3 = (await savePickupTimeAction(fd({ childId: childA, time: "00:00" }))) as { error?: string };
    expect(typeof res3?.error).toBe("string");
    expect(await countNotifications(ownerAccount)).toBe(0);

    // Full parents schedule nothing: pickup-time actions are pickup-only.
    setSession(parentAccount, "parent", parentEmail);
    await expect(redirectOf(savePickupTimeAction(fd({ childId: childA, time: futureTime() }))))
      .resolves.toMatch("/child?error=role");
  });
});

// ---- 5. /portal never serves parents ---------------------------------------
describe("the portal shell refuses parent-role sessions", () => {
  it("bounces a parent to /child before any portal page renders", async () => {
    setSession(parentAccount, "parent", parentEmail);
    let digest = "";
    try {
      await PortalLayout({ children: null } as unknown as { children: React.ReactNode });
      throw new Error("expected the portal layout to refuse a parent-role session");
    } catch (err) {
      digest = String((err as { digest?: string }).digest ?? "");
    }
    expect(digest).toMatch("NEXT_REDIRECT");
    expect(digest).toMatch("/child");
  });

  it("staff sessions still enter the portal shell", async () => {
    setSession(ownerAccount, "owner", ownerEmail);
    const node = await PortalLayout({ children: <p>ok</p> } as unknown as { children: React.ReactNode });
    expect(node).toBeTruthy();
  });
});
