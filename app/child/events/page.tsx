import { requireFamilyPage } from "@/lib/require";
import { listEvents, eventMedia, listVideos } from "@/lib/store";
import { firstInstituteId, cap } from "@/lib/helpers";
import { signedUrlsForRefs } from "@/lib/storage";
import { i18nForAccount } from "@/lib/i18n-session";
import { fmtTimeFor, tr } from "@/lib/i18n";
import { recordToolUsage } from "@/lib/tool-usage";

export const dynamic = "force-dynamic";

// KID-368: event start/end times are stored as bare "HH:MM(…)" wall-clock
// strings and the shared fmtTime feeds them straight to `new Date(...)`,
// which renders "Invalid Date" on the live tab. Parse the bare time first;
// real ISO timestamps keep the locale time formatting.
function prettyEventTime(v: unknown, locale: "en" | "ar" = "en"): string {
  if (!v) return "";
  const m = String(v).match(/^(\d{1,2}):(\d{2})/);
  if (m) return `${m[1].padStart(2, "0")}:${m[2]}`;
  return fmtTimeFor(locale, v) || String(v);
}

export default async function ParentEventsPage() {
  const session = await requireFamilyPage("/child/events");
  const { locale, dict } = await i18nForAccount(session.accountId);
  const t = (key: string, vars?: Record<string, string | number>) => tr(dict, key, vars);
  const instituteId = await firstInstituteId();
  if (!instituteId) return <p className="muted">{t("events.noInstitute")}</p>;
  await recordToolUsage({ instituteId: String(instituteId ?? "") || null, accountId: session.accountId, toolKey: "events", source: "child", metadata: null });

  // KID-2480: a family sees center-wide events plus events targeted at its
  // own children's classrooms. The store fails closed (no links = no class
  // events), so another room's event is never rendered here.
  const [events, videos] = await Promise.all([
    listEvents(instituteId, true, session.role === "parent" ? { parentAccountId: session.accountId } : {}),
    listVideos(instituteId),
  ]);
  const withMedia = await Promise.all(
    events.map(async (e: any) => ({ ...e, media: await eventMedia(e.id) }))
  );
  // KID-2466: event media (and the video shelf) are private REFs; resolve them
  // through short-lived signed URLs before anything renders.
  const eventRefs = withMedia.flatMap((e: any) => e.media.map((m: any) => String(m.url ?? "")));
  const mediaSrcs = await signedUrlsForRefs([...eventRefs, ...videos.map((v: any) => String(v.url ?? ""))]);

  return (
    <div>
      <h1 className="title">{t("events.title")}</h1>
      <div className="subtitle">{t("events.subtitle")}</div>

      <h3 className="subtitle">{t("events.upcoming")}</h3>
      {withMedia.length === 0 && <p className="muted small mb-4">{t("events.noUpcoming")}</p>}
      <div className="grid mb-4">
        {withMedia.map((e: any) => (
          <div className="card" key={e.id}>
            <div style={{ marginBottom: 8 }}>
              <span className="badge">{cap(e.event_date)}</span>
              {e.classroom_name && <span className="badge" style={{ marginInlineStart: 6 }}>{e.classroom_name}</span>}
            </div>
            <div style={{ fontWeight: 700, fontSize: 17 }}>{e.title}</div>
            {e.start_time && <div className="muted small">{prettyEventTime(e.start_time, locale)}{e.end_time ? ` – ${prettyEventTime(e.end_time, locale)}` : ""}</div>}
            {e.location && <div className="muted small">📍 {e.location}</div>}
            {e.description && <p className="small mt-2">{e.description}</p>}
            {e.media.length > 0 && (
              <div className="row mt-2">
                {e.media.slice(0, 4).map((m: any) => {
                  // Never fall back to the raw REF when signing failed.
                  const src = mediaSrcs.get(String(m.url ?? "")) ?? "";
                  if (!src) return null;
                  if (String(m.kind) === "video") {
                    return (
                      <video
                        key={m.id}
                        src={src}
                        controls
                        playsInline
                        preload="metadata"
                        style={{ width: 96, height: 72, objectFit: "cover", borderRadius: 8 }}
                      />
                    );
                  }
                  return (
                    <a key={m.id} href={src} target="_blank" rel="noreferrer">
                      <img src={src} alt={m.caption ?? e.title} width={96} height={72} style={{ objectFit: "cover", borderRadius: 8 }} />
                    </a>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      <h3 className="subtitle">{t("events.videos")}</h3>
      {videos.length === 0 && <p className="muted small">{t("events.noVideos")}</p>}
      <div className="grid">
        {videos.map((v: any) => {
          const src = mediaSrcs.get(String(v.url ?? "")) ?? "";
          if (!src) return null;
          return (
            <div className="card" key={v.id}>
              <a href={src} target="_blank" rel="noreferrer" style={{ display: "block" }}>
                <video src={src} controls playsInline preload="metadata" style={{ width: "100%", borderRadius: 8, maxHeight: 180, objectFit: "cover" }} />
              </a>
              {v.caption && <p className="small mt-2">{v.caption}</p>}
              {v.first_name && <div className="muted small">{v.first_name} {v.last_name}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}