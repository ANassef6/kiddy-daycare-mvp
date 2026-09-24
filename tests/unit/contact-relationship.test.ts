// KID-112: contact relationship dropdown (4 roles) + access enforcement.

import { beforeEach, describe, expect, it } from "vitest";
import {
  CONTACT_RELATIONSHIPS,
  effectiveAccess,
  isActionAllowed,
  isContactRelationship,
  isPathAllowedForPickup,
  normalizeLegacyRelationship,
  parseContactRelationship,
} from "@/lib/contact-relationship";
import * as store from "@/lib/store";
import { createAccount } from "@/lib/auth";
import { queryAll, queryGet } from "@/lib/db";
import { seedFixture } from "../helpers";

describe("contact relationship enum", () => {
  it("exposes exactly the 4 required options", () => {
    expect([...CONTACT_RELATIONSHIPS]).toEqual(["parent", "family", "pickup", "no_access"]);
  });

  it("rejects free text", () => {
    expect(isContactRelationship("Mother")).toBe(false);
    expect(isContactRelationship("")).toBe(false);
    expect(isContactRelationship("Grandparent")).toBe(false);
    expect(() => parseContactRelationship("Mother")).toThrow();
    expect(parseContactRelationship("family")).toBe("family");
  });

  it("maps legacy free text to canonical roles with nothing left over", () => {
    expect(normalizeLegacyRelationship("Mother")).toBe("parent");
    expect(normalizeLegacyRelationship("Father")).toBe("parent");
    expect(normalizeLegacyRelationship("Guardian")).toBe("parent");
    expect(normalizeLegacyRelationship("Grandmother")).toBe("family");
    expect(normalizeLegacyRelationship("Uncle")).toBe("family");
    expect(normalizeLegacyRelationship("pickup person")).toBe("pickup");
    expect(normalizeLegacyRelationship("Driver")).toBe("pickup");
    expect(normalizeLegacyRelationship("No access")).toBe("no_access");
    expect(normalizeLegacyRelationship("unpaid")).toBe("no_access");
    expect(normalizeLegacyRelationship("")).toBe("parent");
    expect(normalizeLegacyRelationship("  Family ")).toBe("family");
    for (const v of ["Mother", "Grandpa", "Nanny", "blocked", "", "рованном"]) {
      expect(isContactRelationship(normalizeLegacyRelationship(v))).toBe(true);
    }
  });
});

describe("access ladder", () => {
  it("parent allows everything; no_access allows nothing", () => {
    for (const action of ["checkInOut", "respondConsent", "submitForm", "sendMessage", "comment"]) {
      expect(isActionAllowed("parent", action)).toBe(true);
      expect(isActionAllowed("no_access", action)).toBe(false);
    }
  });

  it("family is limited: no consents/forms/incidents/support, but loop + messaging work", () => {
    expect(isActionAllowed("family", "respondConsent")).toBe(false);
    expect(isActionAllowed("family", "submitForm")).toBe(false);
    expect(isActionAllowed("family", "acknowledgeIncident")).toBe(false);
    expect(isActionAllowed("family", "createSupportTicket")).toBe(false);
    expect(isActionAllowed("family", "checkInOut")).toBe(true);
    expect(isActionAllowed("family", "sendMessage")).toBe(true);
    expect(isActionAllowed("family", "comment")).toBe(true);
  });

  it("pickup may only register pickup time", () => {
    expect(isActionAllowed("pickup", "checkInOut")).toBe(true);
    expect(isActionAllowed("pickup", "sendMessage")).toBe(false);
    expect(isActionAllowed("pickup", "respondConsent")).toBe(false);
    expect(isPathAllowedForPickup("/child")).toBe(true);
    expect(isPathAllowedForPickup("/child/abc123")).toBe(true);
    expect(isPathAllowedForPickup("/child/settings")).toBe(true);
    expect(isPathAllowedForPickup("/child/newsfeed")).toBe(false);
    expect(isPathAllowedForPickup("/child/messages")).toBe(false);
    expect(isPathAllowedForPickup("/child/consents")).toBe(false);
  });

  it("effective access is most-permissive-wins", () => {
    expect(effectiveAccess([])).toBeNull();
    expect(effectiveAccess(["pickup"])).toBe("pickup");
    expect(effectiveAccess(["pickup", "family"])).toBe("family");
    expect(effectiveAccess(["family", "parent"])).toBe("parent");
    expect(effectiveAccess(["no_access"])).toBe("no_access");
  });
});

describe("store enforcement", () => {
  let childId: string;

  beforeEach(async () => {
    await seedFixture();
    childId = String((await queryGet("SELECT id FROM child LIMIT 1"))!.id);
  });

  it("addContact rejects free-text relationships", async () => {
    await expect(
      store.addContact({ childId, fullName: "X", relationship: "Grandma", phone: "1", email: "", isPickup: false, isEmergency: false })
    ).rejects.toThrow();
    const row = await store.addContact({
      childId, fullName: "Y", relationship: "family", phone: "1", email: "", isPickup: false, isEmergency: false,
    });
    expect(String(row.relationship)).toBe("family");
  });

  it("linkFamily stores the role and familyAccessForAccount resolves it", async () => {
    const acc = await createAccount({ email: "fam@test", password: "x", fullName: "Fam", role: "parent" });
    await store.linkFamily(String(acc.id), childId, "pickup");
    expect(await store.familyAccessForAccount(String(acc.id))).toBe("pickup");
    await store.linkFamily(String(acc.id), childId, "family");
    expect(await store.familyAccessForAccount(String(acc.id))).toBe("family");
    await expect(store.linkFamily(String(acc.id), childId, "Cousin")).rejects.toThrow();
  });

  it("migration leaves no free-text relationships behind", async () => {
    const { queryRun } = await import("@/lib/db");
    // Insert legacy rows bypassing validation, then run the normalizer.
    const { uid } = await import("@/lib/db");
    await queryRun("INSERT INTO contact (id, child_id, full_name, relationship) VALUES (?, ?, ?, ?)", uid(), childId, "Legacy Mom", "Mother");
    await queryRun("INSERT INTO contact (id, child_id, full_name, relationship) VALUES (?, ?, ?, ?)", uid(), childId, "Legacy Driver", "Driver");
    const res = await store.normalizeAllContactRelationships();
    expect(res.updated).toBeGreaterThanOrEqual(2);
    const leftovers = await queryAll(
      "SELECT id FROM contact WHERE relationship NOT IN ('parent','family','pickup','no_access')"
    );
    expect(leftovers).toEqual([]);
    const links = await queryAll(
      "SELECT id FROM family_member WHERE role NOT IN ('parent','family','pickup','no_access')"
    );
    expect(links).toEqual([]);
  });

  it("createInvite carries the relationship role", async () => {
    const iid = String((await queryGet("SELECT id FROM institute LIMIT 1"))!.id);
    const invite = await store.createInvite(iid, childId, "new@test", "ROLE-1", "family");
    expect(String(invite.role)).toBe("family");
    await expect(store.createInvite(iid, childId, "bad@test", "ROLE-2", "Cousin")).rejects.toThrow();
  });
});
