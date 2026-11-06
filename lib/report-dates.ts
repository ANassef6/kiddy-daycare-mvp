// KID-472 item 4: pure date helpers for the daily report's date navigation.
// Both server components and the client date-nav component import this, so it
// must stay free of server/db/browser dependencies. All math is UTC so a
// rendered date never drifts by a day between server and client timezones.

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// `2026-02-30` fails even though the regex matches — the round-trip returns a
// different calendar day than the input.
export function isIsoDate(v: unknown): boolean {
  const s = String(v ?? "");
  if (!ISO_DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// The single choke point for a `?date=` query/hidden-field value: anything
// missing, malformed, or out of range falls back to the supplied default
// (today) instead of reaching the store with a bogus report_date.
export function configuredReportDate(v: unknown, fallback: string): string {
  return isIsoDate(v) ? String(v) : fallback;
}

export function shiftIsoDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// The recent-days window for the compact strip: `days` dates ending on the
// later of the selected date and today, newest last. Clamping the end to
// max(selected, today) keeps today's chip reachable from any past selection.
export function recentDatesUpTo(endDate: string, days: number): string[] {
  const anchorEnd = [endDate, todayIso()]
    .filter(isIsoDate)
    .sort()
    .pop() as string;
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) out.push(shiftIsoDate(anchorEnd, -i));
  return out;
}
