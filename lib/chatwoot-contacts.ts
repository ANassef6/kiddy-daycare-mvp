// Link Kiddy accounts to Chatwoot contacts.
//
// Two directions, both keyed by the stable Kiddy account id:
//   - server-side: on account creation (and from the identity route) upsert a
//     Chatwoot contact so support sees name/email/role/daycare/children even
//     before the customer opens the widget;
//   - client-side: the widget fetches this account's identity and calls
//     `setUser` so the live conversation is attached to that same contact.
//
// Server-only: CHATWOOT_ACCESS_TOKEN and CHATWOOT_HMAC_TOKEN must never reach
// the browser. CHATWOOT_BASE_URL / CHATWOOT_ACCESS_TOKEN are the same values
// already used by the Help Center (lib/help-chatwoot.ts).

import crypto from "crypto";
import { queryAll, queryGet } from "./db";
import { PLATFORM_OPERATOR_ROLE } from "./platform";

const REQUEST_TIMEOUT_MS = 4000;

export type ChatwootContactsConfig = {
  baseUrl: string;
  accountId: string;
  token: string;
  hmacToken: string;
};

export type ChatwootContactAttributes = Record<string, string>;

export type ChatwootContactPayload = {
  identifier: string;
  name: string;
  email: string;
  phone_number?: string;
  company_name?: string;
  description?: string;
  custom_attributes: ChatwootContactAttributes;
};

export type ChatwootIdentity = ChatwootContactPayload & {
  identifier_hash?: string;
};

export function chatwootContactsConfig(
  env: Record<string, string | undefined> = process.env,
): ChatwootContactsConfig | null {
  const baseUrl = (env.CHATWOOT_BASE_URL ?? "").trim();
  const token = (env.CHATWOOT_ACCESS_TOKEN ?? "").trim();
  if (!baseUrl || !token) return null;
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    accountId: (env.CHATWOOT_ACCOUNT_ID ?? "").trim() || "1",
    token,
    hmacToken: (env.CHATWOOT_HMAC_TOKEN ?? "").trim(),
  };
}

/** Chatwoot identity-validation hash: HMAC-SHA256(identifier, inbox hmac token). */
export function chatwootIdentifierHash(identifier: string, hmacToken: string): string {
  return crypto.createHmac("sha256", hmacToken).update(identifier).digest("hex");
}

function uniqueNames(rows: { first_name?: unknown; last_name?: unknown }[]): string[] {
  const names = rows
    .map((row) => [row.first_name, row.last_name].map((part) => String(part ?? "").trim()).filter(Boolean).join(" "))
    .filter(Boolean);
  return [...new Set(names)];
}

async function institutesForAccount(accountId: string) {
  return queryAll(
    `SELECT DISTINCT i.id, i.name
       FROM institute i
      WHERE i.id IN (
        SELECT c.institute_id
          FROM family_member fm
          JOIN child c ON c.id = fm.child_id
         WHERE fm.account_id = ?
        UNION
        SELECT inv.institute_id
          FROM account a
          JOIN invite inv ON lower(trim(inv.email)) = lower(trim(a.email))
         WHERE a.id = ?
        UNION
        SELECT s.institute_id
          FROM account a
          JOIN staff s ON s.id = a.staff_id
         WHERE a.id = ?
      )
      ORDER BY i.name`,
    accountId,
    accountId,
    accountId,
  );
}

async function phoneForAccount(accountId: string, email: string, staffId: unknown): Promise<string | undefined> {
  if (staffId) {
    const staff = await queryGet("SELECT phone FROM staff WHERE id = ?", String(staffId));
    const phone = String(staff?.phone ?? "").trim();
    if (phone) return phone;
  }
  if (!email) return undefined;
  const contact = await queryGet(
    `SELECT phone FROM contact
      WHERE lower(trim(email)) = lower(trim(?))
        AND phone IS NOT NULL
        AND trim(phone) <> ''
      ORDER BY created_at DESC
      LIMIT 1`,
    email,
  );
  const phone = String(contact?.phone ?? "").trim();
  return phone || undefined;
}

/**
 * Build the Chatwoot contact view for one Kiddy account. Returns null for
 * accounts that must never become support contacts (system / platform operator)
 * or when the account no longer exists.
 */
export async function chatwootContactPayloadForAccount(accountId: string): Promise<ChatwootContactPayload | null> {
  const id = String(accountId ?? "").trim();
  if (!id) return null;
  const account = await queryGet(
    "SELECT id, email, full_name, role, language, staff_id FROM account WHERE id = ?",
    id,
  );
  if (!account) return null;
  const role = String(account.role ?? "").trim();
  if (!role || role === "system" || role === PLATFORM_OPERATOR_ROLE) return null;

  const email = String(account.email ?? "").trim();
  const name = String(account.full_name ?? "").trim() || email;
  const language = String(account.language ?? "").trim();
  const institutes = await institutesForAccount(id);
  const children = uniqueNames(
    await queryAll(
      `SELECT c.first_name, c.last_name
         FROM family_member fm
         JOIN child c ON c.id = fm.child_id
        WHERE fm.account_id = ? AND c.active = 1
        ORDER BY c.first_name, c.last_name`,
      id,
    ),
  );
  const daycare = institutes
    .map((row) => String(row.name ?? "").trim())
    .filter(Boolean)
    .join(", ");
  const childNames = children.join(", ");
  const phone = await phoneForAccount(id, email, account.staff_id);

  const customAttributes: ChatwootContactAttributes = {
    kiddy_account_id: id,
    kiddy_role: role,
    kiddy_daycare: daycare,
    kiddy_children: childNames,
    kiddy_language: language,
  };

  const descriptionParts = [`Kiddy ${role}`];
  if (daycare) descriptionParts.push(daycare);
  if (childNames) descriptionParts.push(`Children: ${childNames}`);
  descriptionParts.push(`Account: ${id}`);

  return {
    identifier: id,
    name,
    email,
    phone_number: phone,
    company_name: daycare || undefined,
    description: descriptionParts.join(" • ").slice(0, 500),
    custom_attributes: customAttributes,
  };
}

async function chatwootRequest(
  config: ChatwootContactsConfig,
  path: string,
  init: { method: string; body?: string },
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
      method: init.method,
      body: init.body,
      headers: {
        api_access_token: config.token,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`);
    }
    if (response.status === 204) return null;
    const raw = await response.text();
    return raw ? JSON.parse(raw) : null;
  } finally {
    clearTimeout(timer);
  }
}

async function findContactId(
  config: ChatwootContactsConfig,
  identifier: string,
): Promise<number | null> {
  const data = (await chatwootRequest(
    config,
    `/api/v1/accounts/${config.accountId}/contacts/search?q=${encodeURIComponent(identifier)}`,
    { method: "GET" },
  )) as { payload?: Array<{ id?: unknown; identifier?: unknown }> } | null;
  const match = Array.isArray(data?.payload)
    ? data.payload.find((contact) => String(contact.identifier ?? "") === identifier)
    : undefined;
  const contactId = Number(match?.id);
  return Number.isFinite(contactId) && contactId > 0 ? contactId : null;
}

function contactRequestBody(payload: ChatwootContactPayload): string {
  return JSON.stringify({
    identifier: payload.identifier,
    name: payload.name,
    email: payload.email,
    ...(payload.phone_number ? { phone_number: payload.phone_number } : {}),
    additional_attributes: {
      company_name: payload.company_name ?? "",
      description: payload.description ?? "",
    },
    custom_attributes: payload.custom_attributes,
  });
}

async function updateContact(config: ChatwootContactsConfig, contactId: number, body: string): Promise<void> {
  await chatwootRequest(
    config,
    `/api/v1/accounts/${config.accountId}/contacts/${contactId}`,
    { method: "PATCH", body },
  );
}

async function upsertChatwootContact(
  config: ChatwootContactsConfig,
  payload: ChatwootContactPayload,
): Promise<void> {
  const body = contactRequestBody(payload);
  const existingId = await findContactId(config, payload.identifier);
  if (existingId) {
    await updateContact(config, existingId, body);
    return;
  }
  try {
    await chatwootRequest(
      config,
      `/api/v1/accounts/${config.accountId}/contacts`,
      { method: "POST", body },
    );
  } catch (error) {
    // A concurrent sync may have created the contact between search and create.
    const racedId = await findContactId(config, payload.identifier);
    if (!racedId) throw error;
    await updateContact(config, racedId, body);
  }
}

/** Best-effort upsert; never throws (account creation must not depend on Chatwoot). */
export async function syncChatwootContactForAccount(accountId: string): Promise<void> {
  const config = chatwootContactsConfig();
  if (!config) return;
  try {
    const payload = await chatwootContactPayloadForAccount(accountId);
    if (!payload) return;
    await upsertChatwootContact(config, payload);
  } catch (error) {
    console.error(
      `Chatwoot contact sync failed for account ${accountId}:`,
      error instanceof Error ? error.message : error,
    );
  }
}

/** Identity payload returned to the signed-in browser for widget `setUser`. */
export async function chatwootIdentityForAccount(accountId: string): Promise<ChatwootIdentity | null> {
  const payload = await chatwootContactPayloadForAccount(accountId);
  if (!payload) return null;
  const config = chatwootContactsConfig();
  return {
    ...payload,
    ...(config?.hmacToken
      ? { identifier_hash: chatwootIdentifierHash(payload.identifier, config.hmacToken) }
      : {}),
  };
}
