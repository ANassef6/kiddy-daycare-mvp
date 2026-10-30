import { requireSession } from "@/lib/require";
import { listEvents, eventMedia } from "@/lib/store";
import { firstInstituteId } from "@/lib/helpers";
import { createEventAction, addEventMediaAction } from "@/lib/actions";
import { i18nForAccount } from "@/lib/i18n-session";
import { fmtTimeFor, tr } from "@/lib/i18n";

export const dynamic = "force-dynamic";

// KID-221: the events creator page was English-only inside an Arabic shell.
// Event dates (DB rows like "saturday") come through in the active locale
// via a weekday-map, so the card badge stops leaking English day names.
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export default async function PortalEventsPage({ searchParams }: { searchParams: { open?: string } }) {
  const session = requireSession();
  const { locale, dict } = await i18nForAccount(session.accountId);
  const t = (key: string, vars?: Record<string, string | number>) => tr(dict, key, vars);
  const instituteId = await firstInstituteId();
  if (!instituteId) return <p className="muted">{t("events.noInstitute")}</p>;
  const events = await listEvents(instituteId);
  const withMedia = await Promise.all(events.map(async (e: any) => ({ ...e, media: await eventMedia(e.id) })));
  const openId = searchParams.open;
  const weekdayLabel = (raw: unknown) => {
    const idx = WEEKDAYS.indexOf(String(raw ?? "").toLowerCase());
    if (idx < 0) return String(raw ?? "");
    const d = new Date(Date.UTC(2026, 9, 4 + idx));
    return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { weekday: "long" }).format(d);
  };

  return (
    <div>
      <h1 className="title">{t("events.title")}</h1>

      <div className="card mb-4">
        <h3 className="subtitle">{t("events.addEvent")}</h3>
        <form action={createEventAction}>
          <div className="row">
            <div className="col field"><label className="label">{t("events.titleLabel")}</label><input className="input" name="title" required /></div>
            <div className="col field"><label className="label">{t("events.dateLabel")}</label><input className="input" type="date" name="eventDate" required /></div>
            <div className="col field"><label className="label">{t("events.startLabel")}</label><input className="input" type="time" name="startTime" /></div>
            <div className="col field"><label className="label">{t("events.endLabel")}</label><input className="input" type="time" name="endTime" /></div>
          </div>
          <div className="field"><label className="label">{t("events.locationLabel")}</label><input className="input" name="location" placeholder={t("events.locationPlaceholder")} /></div>
          <div className="field"><label className="label">{t("events.descriptionLabel")}</label><textarea className="textarea" name="description" /></div>
          <button className="btn btn-primary" type="submit">{t("events.addBtn")}</button>
        </form>
      </div>

      <div className="grid">
        {withMedia.map((e: any) => (
          <div className="card" key={e.id}>
            <div className="status-card">
              <div className="badge">{weekdayLabel(e.event_date)}</div>
              <div className="muted small">{t("events.mediaCount", { count: e.media_count })}</div>
            </div>
            <div style={{ fontWeight: 700, fontSize: 17, marginTop: 8 }}>{e.title}</div>
            {e.start_time && <div className="muted small">{fmtTimeFor(locale, e.start_time)}{e.end_time ? ` – ${fmtTimeFor(locale, e.end_time)}` : ""}</div>}
            {e.location && <div className="muted small">📍 {e.location}</div>}
            {e.description && <p className="small mt-2">{e.description}</p>}
            {e.media.length > 0 && (
              <div className="row mt-2">
                {e.media.map((m: any) => (
                  <a key={m.id} href={m.url} target="_blank" rel="noreferrer">
                    <img src={m.url} alt={m.caption ?? e.title} width={80} height={60} style={{ objectFit: "cover", borderRadius: 8 }} />
                  </a>
                ))}
              </div>
            )}
            {openId === e.id && (
              <form action={addEventMediaAction} className="mt-3 row">
                <input type="hidden" name="eventId" value={e.id} />
                <input className="input" name="url" placeholder={t("events.mediaUrlPlaceholder")} required style={{ flex: 1 }} />
                <select className="select" name="kind" style={{ width: 110 }}>
                  <option value="image">{t("events.photo")}</option><option value="video">{t("events.video")}</option>
                </select>
                <button className="btn btn-ghost" type="submit">{t("events.attach")}</button>
              </form>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
