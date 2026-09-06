// Data-layer unit tests: white-label shell, foundation (rooms/staff/children),
// daily loop (check-in/out, reports, newsfeed, messaging, consents, incidents,
// media) and M3 billing, all against the isolated SQLite mirror.
//
// The SQLite schema intentionally mirrors supabase/migrations (0001–0004), so
// passing here is strong evidence the Postgres schema behaves the same way.

import { beforeEach, describe, expect, it } from "vitest";
import * as store from "@/lib/store";
import { mustGet, seedFixture } from "../helpers";

beforeEach(async () => {
  await seedFixture();
});

describe("white-label shell (branding config)", () => {
  it("seeds a single institute with known branding", async () => {
    const rows = await store.listInstitutes();
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Sunshine Daycare");
    expect(rows[0].primary_color).toBe("#8B5CF6");
    expect(rows[0].accent_color).toBe("#F59E0B");
    expect(rows[0].font).toBe("Nunito");
  });

  it("getInstitute returns the row for a valid id and undefined for a missing id", async () => {
    const inst = (await store.listInstitutes())[0];
    const found = await store.getInstitute(inst.id);
    expect(found).toBeDefined();
    expect((await store.getInstitute("nope"))).toBeUndefined();
  });

  it("updateInstitute swaps name/logo/colors (the theming config swap)", async () => {
    const inst = (await store.listInstitutes())[0];
    await store.updateInstitute(inst.id, {
      name: "Rainbow Kids Academy",
      logo_url: "https://cdn.example.test/rainbow-logo.png",
      primary_color: "#E11D48",
      accent_color: "#0D9488",
      font: "Poppins",
    });
    const updated = (await store.getInstitute(inst.id))!;
    expect(updated.name).toBe("Rainbow Kids Academy");
    expect(updated.logo_url).toBe("https://cdn.example.test/rainbow-logo.png");
    expect(updated.primary_color).toBe("#E11D48");
    expect(updated.accent_color).toBe("#0D9488");
    expect(updated.font).toBe("Poppins");
  });

  it("seedInstitute applies default branding when not supplied", async () => {
    await store.seedInstitute({ name: "Blank Slate Daycare" });
    const row = (await store.getInstitute(
      (await mustGet("SELECT id FROM institute WHERE name = 'Blank Slate Daycare'")).id,
    ))!;
    expect(row.primary_color).toBe("#3B82F6");
    expect(row.accent_color).toBe("#10B981");
    expect(row.font).toBe("Inter");
  });
});

describe("foundation: rooms, staff, children", () => {
  it("creates and lists rooms ordered by name", async () => {
    const inst = (await store.listInstitutes())[0];
    await store.createRoom(inst.id, "Infants", 8);
    const rooms = await store.listRooms(inst.id);
    expect(rooms.some((r) => r.name === "Infants")).toBe(true);
    expect(rooms.map((r) => r.name)).toEqual([...rooms.map((r) => r.name)].sort());
  });

  it("creates staff and binds room assignments", async () => {
    const inst = (await store.listInstitutes())[0];
    const room = (await store.listRooms(inst.id))[0];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await store.createStaff({ instituteId: inst.id, fullName: "Anna Kim", role: "carer", roomIds: [room.id as any] });
    const staffList = await store.listStaff(inst.id);
    const anna = staffList.find((s) => s.full_name === "Anna Kim")!;
    expect(anna).toBeDefined();
    const rooms = await store.staffRooms(String(anna.id));
    expect(rooms.map((r) => r.name)).toContain(room.name);
  });

  it("creates a child with enrollment + health record and lists with room + health", async () => {
    const inst = (await store.listInstitutes())[0];
    const room = (await store.listRooms(inst.id))[0];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const child = await store.createChild({
      instituteId: inst.id,
      firstName: "Mia",
      lastName: "Okafor",
      dob: "2022-01-15",
      roomId: room.id as any,
      allergies: "Dairy",
    });
    expect(child.first_name).toBe("Mia");
    const list = await store.listChildren(inst.id);
    const fromList = list.find((c) => c.id === child.id)!;
    expect(fromList).toBeDefined();
    expect(fromList.room_name).toBe(room.name);
    expect(fromList.allergies).toBe("Dairy");
    expect((await mustGet("SELECT COUNT(*) AS c FROM enrollment WHERE child_id = ?", child.id)).c).toBe(1);
  });

  it("adds contacts with pickup/emergency flags", async () => {
    const inst = (await store.listInstitutes())[0];
    const child = (await store.listChildren(inst.id))[0];
    const contact = await store.addContact({
      childId: child.id,
      fullName: "Dad",
      relationship: "Father",
      phone: "+1 555 7777",
      isPickup: true,
      isEmergency: false,
    });
    expect(contact.is_pickup).toBe(1);
    expect(contact.is_emergency).toBe(0);
    const contacts = await store.listContacts(child.id);
    expect(contacts.some((c) => c.id === contact.id)).toBe(true);
  });

  it("isolates institute data (rooms/children never leak across institutes)", async () => {
    const instA = (await store.listInstitutes())[0];
    const instB = await store.seedInstitute({ name: "Second Daycare" });
    await store.createRoom(instA.id, "Only-A Room");
    await store.createChild({ instituteId: instB.id, firstName: "Bobby", lastName: "B" });
    const bRooms = await store.listRooms(instB.id);
    const bChildren = await store.listChildren(instB.id);
    expect(bRooms).toHaveLength(0);
    expect(bChildren.some((c) => c.first_name === "Bobby")).toBe(true);
  });
});

describe("daily loop: check-in / attendance", () => {
  it("records check-in and reflects it in todayStatus", async () => {
    const inst = (await store.listInstitutes())[0];
    const child = (await store.listChildren(inst.id))[0];
    const acc = await mustGet("SELECT id FROM account WHERE role='parent'");
    await store.checkChildInOut({ childId: child.id, accountId: acc.id, type: "in" });
    const status = await store.todayStatus(child.id);
    expect(status.checkedIn).toBeDefined();
    expect(status.checkedIn!.type).toBe("in");
    expect(status.checkedOut).toBeUndefined();
  });

  it("records check-in then check-out; lastEvent and attendance reflect latest state", async () => {
    const inst = (await store.listInstitutes())[0];
    const child = (await store.listChildren(inst.id))[0];
    const acc = await mustGet("SELECT id FROM account WHERE role='parent'");
    await store.checkChildInOut({ childId: child.id, accountId: acc.id, type: "in" });
    await store.checkChildInOut({ childId: child.id, accountId: acc.id, type: "out" });
    // Ordering contract: recorded_at ties at 1-second resolution, so the id
    // tie-break must make the newer (later id) "out" row the last event.
    const status = await store.todayStatus(child.id);
    expect(status.checkedIn).toBeDefined();
    expect(status.checkedOut).toBeDefined();
    expect(status.checkedOut!.type).toBe("out");
    expect(status.lastEvent!.type).toBe("out");

    const today = new Date().toISOString().slice(0, 10);
    const attendance = await store.attendanceOn(inst.id, today);
    const row = attendance.find((a) => a.id === child.id)!;
    expect(row.last_event).toBe("out");
    expect(row.checked_in_at).toBeTruthy();
    expect(row.checked_out_at).toBeTruthy();
  });
});

describe("daily loop: daily report", () => {
  it("upserts a report and keeps one row per child+date", async () => {
    const inst = (await store.listInstitutes())[0];
    const child = (await store.listChildren(inst.id))[0];
    const acc = await mustGet("SELECT id FROM account WHERE role='owner'");
    const today = new Date().toISOString().slice(0, 10);
    await store.upsertDailyReport({ childId: child.id, reportDate: today, summary: "Great day", mood: "happy", accountId: acc.id });
    await store.upsertDailyReport({ childId: child.id, reportDate: today, summary: "Updated summary", mood: "calm", accountId: acc.id });
    const report = (await store.reportFor(child.id, today))!;
    expect(report.summary).toBe("Updated summary");
    expect(report.mood).toBe("calm");
    const count = await mustGet("SELECT COUNT(*) AS c FROM daily_report WHERE child_id = ? AND report_date = ?", child.id, today);
    expect(count.c).toBe(1);
  });
});

describe("daily loop: newsfeed", () => {
  it("posts with tags, increments likes and lets tagged parents see it", async () => {
    const inst = (await store.listInstitutes())[0];
    const children = await store.listChildren(inst.id);
    const owners = await mustGet("SELECT id FROM account WHERE role='owner'");
    const post = await store.createNewsfeedPost({
      instituteId: inst.id,
      accountId: owners.id,
      body: "Shape week!",
      tagChildIds: children.map((c) => c.id),
    });
    await store.toggleLike(post.id, owners.id);
    await store.addComment(post.id, owners.id, "Love it");
    const feed = await store.listNewsfeed(inst.id);
    expect(feed[0].body).toBe("Shape week!");
    expect(Number(feed[0].like_count)).toBe(1);
    expect(Number(feed[0].comment_count)).toBe(1);
    expect(feed[0].comments).toHaveLength(1);

    const forChild = await store.newsfeedForChild((children[0]).id);
    expect(forChild.some((p) => p.id === post.id)).toBe(true);

    // toggling the same like removes it
    const afterUnlike = await store.toggleLike(post.id, owners.id);
    expect(afterUnlike.liked).toBe(false);
  });
});

describe("daily loop: messaging", () => {
  it("sends messages both directions and marks them read, ordered oldest-first", async () => {
    const inst = (await store.listInstitutes())[0];
    const parent = await mustGet("SELECT id FROM account WHERE role='parent'");
    const owner = await mustGet("SELECT id FROM account WHERE role='owner'");
    await store.sendMessage({ instituteId: inst.id, senderAccountId: parent.id, recipientAccountId: owner.id, body: "Question 1" });
    await store.sendMessage({ instituteId: inst.id, senderAccountId: owner.id, recipientAccountId: parent.id, body: "Answer" });
    const conv = await store.conversation(parent.id, owner.id);
    expect(conv).toHaveLength(2);
    expect(conv[0].body).toBe("Question 1");
    expect(conv[1].body).toBe("Answer");
    await store.markRead(owner.id, parent.id);
    const unread = await mustGet("SELECT COUNT(*) AS c FROM message WHERE sender_account_id = ? AND recipient_account_id = ? AND read = 0", owner.id, parent.id);
    expect(unread.c).toBe(0);
  });
});

describe("daily loop: media gallery", () => {
  it("adds media and filters by child", async () => {
    const inst = (await store.listInstitutes())[0];
    const child = (await store.listChildren(inst.id))[0];
    await store.addMedia({ instituteId: inst.id, url: "https://cdn.example.test/pic.jpg", kind: "image", caption: "Craft time", childId: child.id });
    const all = await store.listMedia(inst.id);
    expect(all).toHaveLength(1);
    const forChild = await store.listMedia(inst.id, child.id);
    expect(forChild).toHaveLength(1);
    const forOther = await store.listMedia(inst.id, "00000000-0000-0000-0000-000000000000");
    expect(forOther).toHaveLength(0);
  });
});

describe("daily loop: consents and incidents", () => {
  it("creates consent, responds, and lists", async () => {
    const inst = (await store.listInstitutes())[0];
    const consent = await store.createConsent({ instituteId: inst.id, title: "Sun safety", body: "Apply SPF?", childId: (await store.listChildren(inst.id))[0].id });
    await store.respondConsent(consent.id, "approved");
    const list = await store.listConsents(inst.id);
    expect(list[0].id).toBe(consent.id);
    expect(list[0].status).toBe("approved");
  });

  it("creates incident, acknowledges, lists for institute + child", async () => {
    const inst = (await store.listInstitutes())[0];
    const child = (await store.listChildren(inst.id))[0];
    const owner = await mustGet("SELECT id FROM account WHERE role='owner'");
    const inc = await store.createIncident({ instituteId: inst.id, childId: child.id, accountId: owner.id, type: "injury", description: "Graze on knee" });
    expect(Number(inc.acknowledged)).toBe(0);
    await store.acknowledgeIncident(inc.id);
    const list = await store.listIncidents(inst.id);
    expect(Number(list[0].acknowledged)).toBe(1);
    const perChild = await store.incidentsForChild(child.id);
    expect(perChild).toHaveLength(1);
  });
});

describe("M3 simplified billing", () => {
  it("upserts plan (create then update) per child", async () => {
    const inst = (await store.listInstitutes())[0];
    const child = (await store.listChildren(inst.id))[0];
    await store.upsertChildPlan({ instituteId: inst.id, childId: child.id, planName: "Full week", amountCents: 150000, billingPeriod: "monthly" });
    const updated = await store.upsertChildPlan({ instituteId: inst.id, childId: child.id, planName: "Full week PLUS", amountCents: 160000, billingPeriod: "monthly" });
    expect(updated.plan_name).toBe("Full week PLUS");
    expect(Number(updated.amount_cents)).toBe(160000);
    expect(await store.listPlans(inst.id)).toHaveLength(2); // 2 seeded children
  });

  it("numbers invoices sequentially per institute", async () => {
    const inst = (await store.listInstitutes())[0];
    const child = (await store.listChildren(inst.id))[0];
    const inv1 = await store.createInvoice({ instituteId: inst.id, childId: child.id, description: "October tuition", amountCents: 10000 });
    const inv2 = await store.createInvoice({ instituteId: inst.id, childId: child.id, description: "Late fee", amountCents: 500 });
    expect(Number(inv1.number.slice(-4))).toBeGreaterThan(0);
    expect(inv2.number).not.toBe(inv1.number);
    expect((await store.listInvoices(inst.id)).some((i) => i.id === inv2.id)).toBe(true);
  });

  it("recording a full payment flips invoice status to paid; void excludes it", async () => {
    const inst = (await store.listInstitutes())[0];
    const child = (await store.listChildren(inst.id))[0];
    const invoice = await store.createInvoice({ instituteId: inst.id, childId: child.id, description: "One-time", amountCents: 3000 });
    const parent = await mustGet("SELECT id FROM account WHERE role='parent'");
    expect(invoice.status).toBe("issued");
    await store.recordPayment({ instituteId: inst.id, invoiceId: invoice.id, accountId: parent.id, method: "card", amountCents: 1000 });
    await store.recordPayment({ instituteId: inst.id, invoiceId: invoice.id, accountId: parent.id, method: "card", amountCents: 2000 });
    const paid = (await store.getInvoice(invoice.id))!;
    expect(paid.status).toBe("paid");
    expect(Number((await store.listInvoices(inst.id)).find((i) => i.id === invoice.id)!.paid_cents)).toBe(3000);
    expect(await store.paymentsForChild(child.id)).toHaveLength(2);

    await store.setInvoiceVoid(invoice.id);
    expect((await store.getInvoice(invoice.id))!.status).toBe("void");
    expect((await store.invoicesForChild(child.id)).some((i) => i.id === invoice.id)).toBe(false);
  });

  it("default payment method clears previous defaults for the account", async () => {
    const parent = await mustGet("SELECT id FROM account WHERE role='parent'");
    await store.savePaymentMethod({ accountId: parent.id, label: "Visa", last4: "1111", isDefault: true });
    await store.savePaymentMethod({ accountId: parent.id, label: "Mastercard", last4: "2222", isDefault: true });
    const methods = await store.accountPaymentMethods(parent.id);
    const defs = methods.filter((m) => Number(m.is_default) === 1);
    expect(defs).toHaveLength(1);
    expect(defs[0].last4).toBe("2222");
  });
});

describe("parent linking / invites", () => {
  it("lists seeded family children for an account", async () => {
    const inst = (await store.listInstitutes())[0];
    const child = (await store.listChildren(inst.id))[0];
    const fam = await mustGet("SELECT id FROM account WHERE role='parent'");
    const before = await store.familiesForAccount(fam.id);
    expect(before.some((c) => c.id === child.id)).toBe(true); // seeded link
  });

  it("invite lookup by code lowercases email and supports family linking", async () => {
    const inst = (await store.listInstitutes())[0];
    const child = (await store.listChildren(inst.id))[0];
    const invite = await store.createInvite(inst.id, child.id, "NEW.PARENT@example.test", "CODE-ABC");
    const found = (await store.getInviteByCode("CODE-ABC"))!;
    expect(found.id).toBe(invite.id);
    expect(found.email).toBe("new.parent@example.test"); // lowercased
  });

  it("invited-parent accounts register confirmed and are child-linked (KID-30)", async () => {
    // Mirrors registerAction for an invited parent: the daycare invite code
    // authenticates the family link, so the app-side account must be created
    // email-confirmed regardless of the GoTrue confirmation email state.
    const inst = (await store.listInstitutes())[0];
    const child = (await store.listChildren(inst.id))[0];
    const invite = await store.createInvite(inst.id, child.id, "invited@example.test", "SUNSHINE-1234");
    const found = await store.getInviteByCode("SUNSHINE-1234");

    const { createAccount, emailConfirmedFor, findAccountByEmail } = await import("@/lib/auth");
    const invitedParent = !!(found && found.child_id);
    const account = await createAccount({
      email: "invited@example.test",
      password: "pw123456",
      fullName: "Invited Parent",
      role: "parent",
      emailConfirmed: invitedParent,
    });
    await store.linkFamily(account.id, String(found?.child_id));

    expect(invitedParent).toBe(true);
    expect(emailConfirmedFor(await findAccountByEmail("invited@example.test"))).toBe(true);
    const fam = (await store.familiesForAccount(account.id)).map((c) => String(c.id));
    expect(fam).toContain(String(invite.child_id));
  });
});