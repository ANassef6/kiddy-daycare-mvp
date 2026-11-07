// KID-489 item 3 (KID-492): boundary validation for the parent's payment
// proof upload. Pure, no request scope, no I/O — lib/actions' upload action
// runs it BEFORE any storage or database write, so an unsupported file can
// never create a partial record.
//
// A proof is a PNG, JPG or PDF capped at 5 MB. Anything else (wrong MIME,
// empty file, oversize) is rejected with a code the caller turns into a
// localized error banner; the recommendation it encodes mirrors the accept
// list on the <input type="file">.

export const MAX_PAYMENT_PROOF_BYTES = 5 * 1024 * 1024;

export const PAYMENT_PROOF_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "application/pdf": "pdf",
};

export type PaymentProofValidation =
  | { ok: true; ext: string }
  | { ok: false; code: "type" | "size" };

export function validatePaymentProof(file: { type?: unknown; size?: unknown }): PaymentProofValidation {
  const size = Number(file.size ?? 0);
  if (size > MAX_PAYMENT_PROOF_BYTES) return { ok: false, code: "size" };
  const type = String(file.type ?? "").toLowerCase();
  const ext = PAYMENT_PROOF_TYPES[type];
  if (!ext || !(size > 0)) return { ok: false, code: "type" };
  return { ok: true, ext };
}

/** Storage key inside the kiddy-public bucket. The random suffix makes a
 *  sibling family's URL unguessable; the per-billing folder keeps one
 *  invoice's uploads (current and replaced) together. Caller uploads only
 *  after validatePaymentProof accepted the file. */
export function paymentProofFilename(
  instituteId: string,
  billingId: string,
  ext: string,
  randomSuffix: string
): string {
  return `payments/${instituteId}/${billingId}/proof-${Date.now()}-${randomSuffix}.${ext}`;
}
