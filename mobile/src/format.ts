export function moneyCents(cents: number, currency: string | null): string {
  const symbol = currency === "EUR" ? "€" : "$";
  return `${symbol}${(cents / 100).toFixed(2)}`;
}

export function isoTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d
    .toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    .toUpperCase();
}

export function isoDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const date = d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  return `${date} · ${isoTime(iso)}`;
}

export function isoDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

export function planPeriod(billingPeriod: string | null): string {
  return billingPeriod ? `${billingPeriod.slice(0, 1).toUpperCase()}${billingPeriod.slice(1)}` : "";
}

export function mealSummary(meal: Record<string, string>): string {
  const parts = Object.entries(meal).map(([k, v]) => `${k}: ${v}`);
  return parts.length ? parts.join("  ·  ") : "";
}

export function maskMethod(method: string | null, last4: string | null): string {
  if (last4) return `${method ?? "Card"} •••• ${last4}`;
  return method ?? "Card";
}