// KID-112: single source of truth for contact / family-link relationships.
// Client-safe: no server-only imports. Both `contact.relationship` and
// `family_member.role` use exactly these 4 values.
//
// Access model (enforced server-side in lib/actions.ts + lib/require.ts):
// - parent:    full access to every /child page and write action.
// - family:    KID-486 view-only — full read of every /child page, no
//              business action at all (no check-in/out, messages, likes,
//              comments, consent responses, form submissions, incident
//              acknowledgements, support tickets), and no message
//              notifications. Only its OWN account details are editable.
// - pickup:    KID-486 minimal — only the /child pickup page: child name +
//              photo, today's planned pickup time, and its own entries.
//              Everything else (child profile, messages, check-in/out,
//              contacts) is refused.
// - no_access: login blocked (e.g. unpaid fees). Admin use.

export const CONTACT_RELATIONSHIPS = ["parent", "family", "pickup", "no_access"] as const;

export type ContactRelationship = (typeof CONTACT_RELATIONSHIPS)[number];

export const CONTACT_RELATIONSHIP_LABELS: Record<ContactRelationship, string> = {
  parent: "Parent",
  family: "Family",
  pickup: "Pickup",
  no_access: "No access",
};

export function isContactRelationship(value: unknown): value is ContactRelationship {
  return typeof value === "string" && (CONTACT_RELATIONSHIPS as readonly string[]).includes(value);
}

export function parseContactRelationship(value: unknown): ContactRelationship {
  if (!isContactRelationship(value)) {
    throw new Error(`Invalid relationship "${String(value)}". Must be one of: parent, family, pickup, no_access.`);
  }
  return value;
}

/** Map legacy free-text values to the 4 canonical roles. No free text remains. */
export function normalizeLegacyRelationship(value: unknown): ContactRelationship {
  const raw = String(value ?? "").trim().toLowerCase();
  if (isContactRelationship(raw)) return raw;
  // Pickup-type values.
  if (/(pick[\s_-]?up|driver|nanny|pick up)/.test(raw)) return "pickup";
  // Explicit blocked values.
  if (/(no[\s_-]?access|blocked|suspended|unpaid|inactive|disabled)/.test(raw)) return "no_access";
  // NOTE: family checks run before parent — "grandmother"/"grandfather"
  // contain "mother"/"father" as substrings.
  // Family-type values.
  if (/(family|grand|aunt|uncle|cousin|brother|sister|sibling|relative|kin|step)/.test(raw)) return "family";
  // Parent-type values (most common default).
  if (/(parent|mother|father|mom|dad|mum|guardian|mommy|daddy|papa|mama|parent\/guardian)/.test(raw)) return "parent";
  // Unknown / empty free text keeps the child attached with full access
  // rather than locking a real parent out; admins can downgrade explicitly.
  return "parent";
}

// ---------- Access helpers (server enforcement) ----------

export type FamilyAccessKind = "parent" | "family" | "pickup" | "no_access";

/** Most permissive wins across a viewer's child links, except no_access never grants. */
export function effectiveAccess(roles: Array<string | null | undefined>): FamilyAccessKind | null {
  const set = new Set(roles.map((r) => String(r ?? "").toLowerCase()).filter(Boolean));
  if (set.size === 0) return null;
  if (set.has("parent")) return "parent";
  if (set.has("family")) return "family";
  if (set.has("pickup")) return "pickup";
  // Only no_access links (or unknown values): treated as blocked.
  return "no_access";
}

// KID-486: pickup login is only the /child pickup page (name + photo, today's
// planned pickup time, own entries) plus account-level settings (its own
// language/password/prefs). Even child detail is out of scope now.
const PICKUP_ALLOWED_PATHS = ["/child", "/child/settings", "/welcome", "/login", "/api/logout"];
/** Section slugs under /child/:id-shaped paths also match this shape, so deny them explicitly. */
const PICKUP_DENIED_SLUGS = new Set([
  "newsfeed",
  "events",
  "learning",
  "drive",
  "forms",
  "consents",
  "messages",
  "incidents",
  "support",
]);
export function isPathAllowedForPickup(pathname: string): boolean {
  if (pathname === "/child") return true;
  const single = pathname.match(/^\/child\/([^/]+)$/);
  if (single) return !PICKUP_DENIED_SLUGS.has(single[1].toLowerCase()) && single[1].toLowerCase() === "settings";
  return PICKUP_ALLOWED_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

// Account-self actions every parent-tier login (family and pickup included)
// keeps: its own language + notification preferences (the /child/settings
// surface). The KID-486 self-account editor (name/password/photo) posts its
// own dedicated action, so it needs no entry here — nothing child-related
// flows through it.
const ACCOUNT_SELF_ACTIONS = new Set([
  "saveLanguage",
  "saveNotificationPrefs",
  "markNotificationRead",
  "saveParentNotificationPrefs",
]);

/** KID-486: pickup-time scheduling is the pickup role's only business write. */
const PICKUP_TIME_ACTIONS = new Set(["savePickupTime", "cancelPickupTime"]);

export function isPickupTimeAction(action: string): boolean {
  return PICKUP_TIME_ACTIONS.has(action);
}

/** KID-486: family links are VIEW-ONLY. Deny by default: the allowlist below
 *  is everything a family (or pickup) login may do; every other action —
 *  check-in/out, messages, likes, comments, consents, forms, incidents,
 *  support tickets, drive uploads — is parent-only. */
export function isActionAllowed(access: FamilyAccessKind, action: string): boolean {
  // Pickup-time writes belong ONLY to pickup links: a parent (or family)
  // access kind never gets them, even though "parent" otherwise allows all.
  if (PICKUP_TIME_ACTIONS.has(action)) return access === "pickup";
  if (access === "parent") return true;
  if (access === "no_access") return false;
  if (access === "family") return ACCOUNT_SELF_ACTIONS.has(action);
  if (access === "pickup") return ACCOUNT_SELF_ACTIONS.has(action);
  return false;
}
