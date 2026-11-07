// KID-489 item 2 (KID-491): the Instapay payment link.
//
// One parser for both boundaries that accept a payment link (the Center
// details form and the new-invoice form): a blank value means "no link"
// (an empty string is stored as NULL so the center/invoice rows read the
// same shape), an absolute http/https URL is stored as given, and anything
// else — relative paths, other schemes (ftp:, javascript:), garbage — is
// rejected so the caller can bounce the user back with a clear error
// instead of persisting a link that would never open.

export type PaymentLinkParse =
  | { ok: true; value: string | null }
  | { ok: false; code: "invalid" };

export function parsePaymentLink(value: unknown): PaymentLinkParse {
  const raw = String(value ?? "").trim();
  if (!raw) return { ok: true, value: null };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, code: "invalid" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, code: "invalid" };
  return { ok: true, value: raw };
}
