// KID-435: the mobile bootstrap's branding must be the signed-in parent's OWN
// daycare, not the first-created institute. On a multi-daycare deployment the
// old getFirstInstitute() pick rendered one daycare's brand inside another
// daycare's mobile app (Sunshine parents of other daycares saw the wrong
// brand on the home screen header).
//
// Route-level, mirroring mobile-child-idor.test.ts: real NextRequest with a
// signed bearer session against the seeded local SQLite fixture.

import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/mobile/bootstrap/route";
import { createAccount, createSessionToken } from "@/lib/auth";
import { createChild, linkFamily, seedInstitute } from "@/lib/store";
import { queryGet } from "@/lib/db";
import { seedFixture } from "../helpers";

async function bootstrapRequest(email: string, accountId: string): Promise<Response> {
  const token = createSessionToken({
    accountId,
    role: "parent",
    email,
    emailConfirmed: true,
  });
  return GET(
    new NextRequest("http://localhost/api/mobile/bootstrap", {
      headers: { authorization: `Bearer ${token}` },
    })
  );
}

beforeEach(async () => {
  await seedFixture();
});

describe("mobile bootstrap branding (KID-435)", () => {
  it("a parent of a NON-first daycare gets their daycare's brand, not the first institute", async () => {
    // Sunshine Daycare is created first by the fixture; add a second daycare
    // with its own parent and prove the bootstrap names THAT daycare.
    const maple = await seedInstitute({ name: "Mapletree Childcare" });
    const mapleChild = await createChild({
      instituteId: String(maple.id),
      firstName: "Ava",
      lastName: "Brown",
      dob: "2021-06-01",
    });
    const mapleParent = await createAccount({
      email: "maple-parent@example.test",
      password: "kiddy-parent",
      fullName: "Ava Brown",
      role: "parent",
    });
    await linkFamily(String(mapleParent.id), String(mapleChild.id));

    const res = await bootstrapRequest(
      "maple-parent@example.test",
      String(mapleParent.id)
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { branding: { name: string } };
    expect(body.branding.name).toBe("Mapletree Childcare");
  });

  it("a Sunshine parent still gets Sunshine's brand (unchanged single-tenant path)", async () => {
    const account = (await queryGet(
      "SELECT * FROM account WHERE lower(email) = lower('parent@example.test')"
    ))!;
    const res = await bootstrapRequest("parent@example.test", String(account.id));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { branding: { name: string } };
    expect(body.branding.name).toBe("Sunshine Daycare");
  });

  it("a session without family links keeps the legacy first-institute fallback", async () => {
    const ghost = await createAccount({
      email: "ghost@example.test",
      password: "kiddy-parent",
      fullName: "Ghost",
      role: "parent",
    });
    const res = await bootstrapRequest("ghost@example.test", String(ghost.id));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { branding: { name: string } };
    expect(body.branding.name).toBe("Sunshine Daycare");
  });
});
