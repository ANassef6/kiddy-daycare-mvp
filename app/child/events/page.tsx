import { requireFamilyPage } from "@/lib/require";
import { listEvents, eventMedia, listVideos } from "@/lib/store";
import { firstInstituteId } from "@/lib/helpers";
import { i18nForAccount } from "@/lib/i18n-session";
import { fmtTimeFor, tr } from "@/lib/i18n";

export const dynamic = "force-dynamic";

// KID-221: the parent's events/videos page was English-only (heading,
// subtitle, "Videos" section, empty states). Localized; event day names come
// from the DB ("saturday" etc.) so they go through a weekday map per locale.
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export default async function ParentEventsPage() {
  const session = await requireFamilyPage("/child/events");
  const { locale, dict } = await i18nForAccount(session.accountId);
  const t = (key: string, vars?: Record<string, string | number>) => tr(dict, key, vars);
  const instituteId = await firstInstituteId();
  if (!instituteId) return <p className="muted">{t("events.noDaycare")}</p>;

  const [events, videos] = await Promise.all([listEvents(instituteId, true), listVideos(instituteId)]);
  const withMedia = await Promise.all(
    events.map(async (e: any) => ({ ...e, media: await eventMedia(e.id) }))
  );
  const weekdayLabel = (raw: unknown) => {
    const idx = WEEKDAYS.indexOf(String(raw ?? "").toLowerCase());
    if (idx < 0) return String(raw ?? "");
    const d = new Date(Date.UTC(2026, 9, 4 + idx));
    return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { weekday: "long" }).format(d);
  };

  return (
    <div>
      <h1 className="title">{t("events.title")}</h1>
      <div className="subtitle">{t("events.parentSubtitle")}</div>

      <h3 className="subtitle">{t("events.upcoming")}</h3>
      {withMedia.length === 0 && <p className="muted small mb-4">{t("events.noUpcoming")}</p>}
      <div className="grid mb-4">
        {withMedia.map((e: any) => (
          <div className="card" key={e.id}>
            <div className="badge" style={{ marginBottom: 8 }}>{weekdayLabel(e.event_date)}</div>
            <div style={{ fontWeight: 700, fontSize: 17 }}>{e.title}</div>
            {e.start_time && <div className="muted small">{fmtTimeFor(locale, e.start_time)}{e.end_time ? ` – ${fmtTimeFor(locale, e.end_time)}` : ""}</div>}
            {e.location && <div className="muted small">📍 {e.location}</div>}
            {e.description && <p className="small mt-2">{e.description}</p>}
            {e.media.length > 0 && (
              <div className="row mt-2">
                {e.media.slice(0, 4).map((m: any) => (
                  <a key={m.id} href={m.url} target="_blank" rel="noreferrer">
                    <img src={m.url} alt={m.caption ?? e.title} width={96} height={72} style={{ objectFit: "cover", borderRadius: 8 }} />
                  </a>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <h3 className="subtitle">{t("events.videosTitle")}</h3>
      {videos.length === 0 && <p className="muted small">{t("events.noVideos")}</p>}
      <div className="grid">
        {videos.map((v: any) => (
          <div className="card" key={v.id}>
            <a href={v.url} target="_blank" rel="noreferrer" style={{ display: "block" }}>
              <video src={v.url} controls style={{ width: "100%", borderRadius: 8, maxHeight: 180, objectFit: "cover" }} />
            </a>
            {v.caption && <p className="small mt-2">{v.caption}</p>}
            {v.first_name && <div className="muted small">{v.first_name} {v.last_name}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
