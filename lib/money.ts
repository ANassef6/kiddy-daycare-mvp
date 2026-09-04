// Minimal money formatting helper for the M3 billing MVP. Amounts are stored
// as integer cents; this formats them with the standard $X.XX shape for the
// default USD currency (the only currency the demo is seeded with).

export function formatMoney(cents: number | bigint | string | null | undefined, currency = "USD"): string {
  const c = Number(cents ?? 0);
  const sign = c < 0 ? "-" : "";
  const abs = Math.abs(c);
  const dollars = Math.floor(abs / 100);
  const remain = abs % 100;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const symbol = (CURRENCY_SYMBOLS as any)[currency] ?? "$";
  return `${sign}${symbol}${dollars.toLocaleString("en-US")}.${String(remain).padStart(2, "0")}`;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  CAD: "C$",
  AUD: "A$",
};

// Parses a dollars input ("120.50" or "$120") into integer cents.
export function parseDollarsToCents(input: string): number {
  const cleaned = String(input ?? "").replace(/[^0-9.\-]/g, "");
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("Enter a valid amount (e.g. 120.50).");
  }
  return Math.round(value * 100);
}