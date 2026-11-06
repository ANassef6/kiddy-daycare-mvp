// KID-489 item 1 (KID-490): the one supported-currency list every currency
// selector, invoice default, and finance display fallback reads from. Before
// this module the codebase hardcoded AED on the finance page and CAD/USD on
// the child-billing form, with a CAD fallback inside the store — three
// disconnected sources that could drift apart.
//
// EGP is the platform's operating currency (lib/billing.ts bills daycares in
// EGP) and the seed default for a center's own invoicing currency.

export const SUPPORTED_CURRENCIES = ["EGP", "AED", "USD", "CAD", "GBP", "EUR", "SAR"] as const;

export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number];

export const DEFAULT_CURRENCY: CurrencyCode = "EGP";

export function isSupportedCurrency(value: unknown): value is CurrencyCode {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(String(value ?? "").trim().toUpperCase());
}

/**
 * Normalizes a currency choice from a form field or a stored row to a code
 * from the central list. Unknown/blank values fall back to `fallback`
 * (defaults to the platform default) instead of throwing — the boundary where
 * this runs only ever receives a <select> value, so an out-of-list value is
 * tampering, not user error, and the write must still stay valid.
 */
export function normalizeCurrency(value: unknown, fallback: string = DEFAULT_CURRENCY): CurrencyCode {
  const candidate = String(value ?? "").trim().toUpperCase();
  if (isSupportedCurrency(candidate)) return candidate;
  const fb = String(fallback ?? "").trim().toUpperCase();
  return isSupportedCurrency(fb) ? fb : DEFAULT_CURRENCY;
}
