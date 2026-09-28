// KID-138: mobile child-scoped endpoints must enforce family membership (IDOR).

import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/mobile/children/[id]/route";
import { POST } from "@/app/api/mobile/children/[id]/check-in/route";
import { createAccount, createSessionToken } from "@/lib/auth";
import { linkFamily } from "@/lib/store";
import { queryGet } from "@/lib/db";
import { seedFixture } from "../helpers";

describe("mobile child IDOR guard", () => {
  let childId: string;

  beforeEach(async () => {
    await seedFixture();
    childId = String((await queryGet("SELECT id FROM child LIMIT 1"))!.id);
  });

  function mobileRequest(
    method: "GET" | "POST",
    targetChildId: string,
    accountId: string,
    body?: object
  ): NextRequest {
    const token = createSessionToken({
      accountId,
      role: "parent",
      email: "parent@example.com",
    });
    const path =
      method === "POST"
        ? `http://localhost/api/mobile/children/${targetChildId}/check-in`
        : `http://localhost/api/mobile/children/${targetChildId}`;
    return new NextRequest(path, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: method === "POST" ? JSON.stringify(body ?? { type: "in" }) : undefined,
    });
  }

  describe("GET /api/mobile/children/[id]", () => {
    it("returns 403 when the caller is not linked to the child", async () => {
      const stranger = await createAccount({
        email: "stranger@example.com",
        password: "password",
        fullName: "Stranger",
        role: "parent",
      });
      const res = await GET(mobileRequest("GET", childId, String(stranger.id)), {
        params: { id: childId },
      });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "forbidden" });
    });

    it("returns 200 when the caller is linked to the child", async () => {
      const parent = await createAccount({
        email: "parent@example.com",
        password: "password",
        fullName: "Parent",
        role: "parent",
      });
      await linkFamily(String(parent.id), childId);
      const res = await GET(mobileRequest("GET", childId, String(parent.id)), {
        params: { id: childId },
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.child).toBeDefined();
      expect(String(json.child.id)).toBe(childId);
    });
  });

  describe("POST /api/mobile/children/[id]/check-in", () => {
    it("returns 403 when the caller is not linked to the child", async () => {
      const stranger = await createAccount({
        email: "stranger-checkin@example.com",
        password: "password",
        fullName: "Stranger",
        role: "parent",
      });
      const res = await POST(
        mobileRequest("POST", childId, String(stranger.id), { type: "in" }),
        { params: { id: childId } }
      );
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "forbidden" });
    });

    it("checks in a linked child and returns 200", async () => {
      const parent = await createAccount({
        email: "parent-checkin@example.com",
        password: "password",
        fullName: "Parent",
        role: "parent",
      });
      await linkFamily(String(parent.id), childId);
      const res = await POST(
        mobileRequest("POST", childId, String(parent.id), { type: "in" }),
        { params: { id: childId } }
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.child).toBeDefined();
      expect(json.status?.checkedIn).not.toBeNull();
    });
  });
});
