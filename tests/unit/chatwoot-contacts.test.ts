// Kiddy <-> Chatwoot contact linking.
//
// The support team only sees useful data if the server-side contact payload is
// complete and if account creation upserts it by the stable Kiddy account id.
// These tests pin the payload shape, the identity HMAC, and the API calls the
// best-effort sync makes.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as store from "@/lib/store";
import { createAccount } from "@/lib/auth";
import {
  chatwootContactPayloadForAccount,
  chatwootIdentifierHash,
  syncChatwootContactForAccount,
} from "@/lib/chatwoot-contacts";
import { seedFixture } from "../helpers";

const fetchMock = vi.fn();

beforeEach(async () => {
  await seedFixture();
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function parentFixture() {
  const institute = await store.seedInstitute({ name: "Chatwoot Test Daycare" });
  const child = await store.createChild({
    instituteId: String(institute.id),
    firstName: "Mila",
    lastName: "Nassef",
  });
  const parent = await createAccount({
    email: "chatwoot-parent@example.test",
    password: "x",
    fullName: "Nouran Hisham",
    role: "parent",
  });
  await store.linkFamily(String(parent.id), String(child.id), "parent");
  await store.addContact({
    childId: String(child.id),
    fullName: "Nouran Hisham",
    relationship: "parent",
    email: "chatwoot-parent@example.test",
    phone: "+201234567890",
    isPickup: false,
    isEmergency: false,
  });
  return { institute, child, parent };
}

describe("Chatwoot contact payload", () => {
  it("signs the identifier with the inbox HMAC token", () => {
    expect(chatwootIdentifierHash("abc", "secret")).toBe(
      "9946dad4e00e913fc8be8e5d3f7e110a4a9e832f83fb09c345285d78638d8a0e",
    );
  });

  it("builds a support-friendly contact for a parent with a child", async () => {
    const { parent } = await parentFixture();
    const payload = await chatwootContactPayloadForAccount(String(parent.id));
    expect(payload).toMatchObject({
      identifier: String(parent.id),
      name: "Nouran Hisham",
      email: "chatwoot-parent@example.test",
      phone_number: "+201234567890",
      company_name: "Chatwoot Test Daycare",
      custom_attributes: {
        kiddy_account_id: String(parent.id),
        kiddy_role: "parent",
        kiddy_daycare: "Chatwoot Test Daycare",
        kiddy_children: "Mila Nassef",
        kiddy_language: "en",
      },
    });
    expect(payload?.description).toContain("Children: Mila Nassef");
  });

  it("never creates contacts for the system or platform operator accounts", async () => {
    const system = await createAccount({
      email: "system-chatwoot@kiddy.local",
      password: "x",
      fullName: "System",
      role: "system",
    });
    const operator = await createAccount({
      email: "operator-chatwoot@kiddy.local",
      password: "x",
      fullName: "Operator",
      role: "platform",
    });
    expect(await chatwootContactPayloadForAccount(String(system.id))).toBeNull();
    expect(await chatwootContactPayloadForAccount(String(operator.id))).toBeNull();
  });
});

describe("Chatwoot contact sync", () => {
  it("does nothing when Chatwoot is not configured", async () => {
    vi.stubGlobal("fetch", fetchMock);
    await syncChatwootContactForAccount("missing");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("creates the contact when the identifier is not in Chatwoot yet", async () => {
    const { parent } = await parentFixture();
    vi.stubEnv("CHATWOOT_BASE_URL", "https://chat.example");
    vi.stubEnv("CHATWOOT_ACCESS_TOKEN", "token-123");
    vi.stubEnv("CHATWOOT_ACCOUNT_ID", "1");
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ payload: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ payload: { id: 99 } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await syncChatwootContactForAccount(String(parent.id));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [searchUrl] = fetchMock.mock.calls[0] as [string];
    expect(searchUrl).toContain("/contacts/search?q=");
    const [createUrl, createInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(createUrl).toBe("https://chat.example/api/v1/accounts/1/contacts");
    expect(createInit.method).toBe("POST");
    const body = JSON.parse(String(createInit.body));
    expect(body.identifier).toBe(String(parent.id));
    expect(body.name).toBe("Nouran Hisham");
    expect(body.custom_attributes.kiddy_role).toBe("parent");
    expect((createInit.headers as Record<string, string>).api_access_token).toBe("token-123");
  });

  it("updates the existing contact when the identifier is already present", async () => {
    const { parent } = await parentFixture();
    vi.stubEnv("CHATWOOT_BASE_URL", "https://chat.example");
    vi.stubEnv("CHATWOOT_ACCESS_TOKEN", "token-123");
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ payload: [{ id: 77, identifier: String(parent.id) }] }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ payload: { id: 77 } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await syncChatwootContactForAccount(String(parent.id));

    const [updateUrl, updateInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(updateUrl).toBe("https://chat.example/api/v1/accounts/1/contacts/77");
    expect(updateInit.method).toBe("PATCH");
  });
});
