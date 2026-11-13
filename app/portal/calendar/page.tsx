import Link from "next/link";
import { requireSession } from "@/lib/require";
import { listEvents } from "@/lib/store";
import { firstInstituteId } from "@/lib/helpers";
import { recordToolUsage } from "@/lib/tool-usage";
import { i18nForAccount } from "@/lib/i18n-session";
import { fmtDateFor, fmtTimeFor, tr } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function PortalCalendarPage() {
  const session = await requireSession();
  const { dict, locale } = await i18nForAccount(session.accountId);
  const instituteId = await firstInstituteId();
  if (!instituteId) return <p className="muted">{tr(dict, "learning.noInstitute")}</p>;
  await recordToolUsage({ instituteId: String(instituteId ?? "") || null, accountId: session.accountId, toolKey: "calendar", source: "portal", metadata: null });
  const events = await listEvents(instituteId, true);

  return (
    <div>
      <h1 className="title">{tr(dict, "calendar.title")}</h1>
      <p className="subtitle">{tr(dict, "calendar.subtitle")}
        <Link href="/portal/events" className="small" style={{ fontWeight: 600, marginInlineStart: 4 }}>{tr(dict, "nav.events")}</Link>{locale === "ar" ? "" : " "}{tr(dict, "calendar.subtitleTail")}</p>

      {events.length === 0 && (
        <div className="card">
          <p className="muted small">{tr(dict, "calendar.empty")}</p>
        </div>
      )}

      {events.map((e: any) => (
        <div className="card mb-4" key={e.id}>
          <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontWeight: 700, fontSize: 17 }}>{e.title}</div>
            <span className="badge">{fmtDateFor(locale, e.event_date)}</span>
          </div>
          <div className="muted small mt-1">
            {fmtDateFor(locale, e.event_date)}
            {e.start_time ? <> · {fmtTimeFor(locale, e.start_time)}{e.end_time ? ` – ${fmtTimeFor(locale, e.end_time)}` : ""}</> : null}
            {e.location ? <> · 📍 {e.location}</> : null}
          </div>
          {e.description && <p className="small mt-2">{e.description}</p>}
        </div>
      ))}
    </div>
  );
}