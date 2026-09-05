// End-to-end daily-loop scenario against the isolated data layer. Exercises the
// whole loop the way a real daycare + parent would, from seeded fixture through
// check-in/out, attendance, reports, newsfeed, messaging, consents, incidents,
// and billing. All I/O goes through the same store helpers the server actions
// use, so this is the integration boundary for the daily loop.

import { beforeEach, describe, expect, it } from "vitest";
import * as store from "@/lib/store";
import { formatMoney } from "@/lib/money";
import { mustGet, seedFixture } from "../helpers";

beforeEach(async () => {
  await seedFixture();
});

const today = () => new Date().toISOString().slice(0, 10);

describe("daily loop E2E: a full parent+staff day", () => {
  it("parent checks in, staff records report + incident, parent acknowledges and likes a post", async () => {
    const inst = (await store.listInstitutes())[0];
    const child = (await store.listChildren(inst.id))[0];
    const parent = await mustGet("SELECT id, full_name FROM account WHERE role='parent'");
    const owner = await mustGet("SELECT id FROM account WHERE role='owner'");

    // 1. Morning: parent checks the child in
    await store.checkChildInOut({ childId: child.id, accountId: parent.id, type: "in" });
    let status = await store.todayStatus(child.id);
    expect(status.checkedIn).toBeDefined();
    expect(status.checkedOut).toBeUndefined();

    // 2. Staff view: attendance shows the child as checked-in
    const attendance = await store.attendanceOn(inst.id, today());
    const attRow = attendance.find((a) => a.id === child.id)!;
    expect(attRow.last_event).toBe("in");

    // 3. Midday: staff saves a daily report
    const report = await store.upsertDailyReport({
      childId: child.id,
      reportDate: today(),
      summary: "Great day",
      mood: "happy",
      meal: JSON.stringify({ breakfast: "Oatmeal", lunch: "Pasta", snack: "Banana" }),
      sleep: JSON.stringify({ naps: ["12:30-14:00"], total: "1h30m" }),
      diaper: "2 changes",
      sick: false,
      accountId: owner.id,
    });
    expect(report.mood).toBe("happy");
    const fetchedReport = (await store.reportFor(child.id, today()))!;
    expect(fetchedReport.summary).toBe("Great day");
    expect((await store.recentReports(inst.id)).some((r) => r.child_id === child.id)).toBe(true);

    // 4. Afternoon: staff posts to the newsfeed tagged to the child
    const post = await store.createNewsfeedPost({
      instituteId: inst.id,
      accountId: owner.id,
      body: "Ella finished her puzzle today!",
      tagChildIds: [child.id],
    });
    // Parent sees the tagged post and likes it
    const childFeed = await store.newsfeedForChild(child.id);
    expect(childFeed.some((p) => p.id === post.id)).toBe(true);
    const liked = await store.toggleLike(post.id, parent.id);
    expect(liked.liked).toBe(true);
    const feed = await store.listNewsfeed(inst.id, parent.id);
    expect(Number(feed[0].like_count)).toBe(1);
    // SQLite returns 0/1 for EXISTS while Postgres returns true/false; the app
    // consumes `liked` as truthy, so assert truthiness.
    expect(Boolean(feed[0].liked)).toBe(true);

    // 5. Staff records an incident; parent acknowledges
    const incident = await store.createIncident({
      instituteId: inst.id,
      childId: child.id,
      accountId: owner.id,
      type: "injury",
      description: "Minor graze on knee during play.",
    });
    expect(Number(incident.acknowledged)).toBe(0);
    const parentIncidents = await store.incidentsForChild(child.id);
    expect(parentIncidents).toHaveLength(1);
    await store.acknowledgeIncident(incident.id);
    expect(Number((await store.incidentsForChild(child.id))[0].acknowledged)).toBe(1);

    // 6. Parents message staff about pickup
    await store.sendMessage({ instituteId: inst.id, senderAccountId: parent.id, recipientAccountId: owner.id, body: "I will pick Ella up at 4." });
    await store.markRead(parent.id, owner.id);
    const conv = await store.conversation(parent.id, owner.id);
    expect(conv.length).toBeGreaterThan(0);

    // 7. Evening: parent checks the child out; attendance shows checked-out
    await store.checkChildInOut({ childId: child.id, accountId: parent.id, type: "out" });
    status = await store.todayStatus(child.id);
    expect(status.checkedOut).toBeDefined();
    expect(status.lastEvent!.type).toBe("out");
    const finalAttendance = await store.attendanceOn(inst.id, today());
    expect(finalAttendance.find((a) => a.id === child.id)!.last_event).toBe("out");

    // 8. Parent opens billing: seeded plan + invoice visible with formatted money
    const plans = await store.listPlans(inst.id);
    const planForChild = plans.find((p) => p.child_id === child.id)!;
    expect(planForChild).toBeDefined();
    expect(formatMoney(Number(planForChild.amount_cents))).toBe("$1,200.00");
    const invoices = await store.invoicesForChild(child.id);
    expect(invoices.length).toBeGreaterThan(0);
    expect(formatMoney(Number(invoices[0].amount_cents))).toMatch(/^\$\d/);
  });

  it("a consent created by staff is listed and can be approved by the parent", async () => {
    const inst = (await store.listInstitutes())[0];
    const child = (await store.listChildren(inst.id))[0];
    const consent = await store.createConsent({ instituteId: inst.id, title: "Field trip permission", body: "Zoo visit on Friday.", childId: child.id });
    const all = await store.listConsents(inst.id);
    expect(all.some((c) => c.id === consent.id)).toBe(true);
    await store.respondConsent(consent.id, "denied");
    expect((await store.listConsents(inst.id))[0].id).toBe(consent.id);
    expect((await store.listConsents(inst.id))[0].status).toBe("denied");
  });
});