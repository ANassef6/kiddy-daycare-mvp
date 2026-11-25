import Link from "next/link";
import { requireSession } from "@/lib/require";
import {
  listEvents,
  eventMedia,
  listRooms,
  eventAudienceRoomIds,
  eventEditableBy,
  canTargetWholeCenter,
} from "@/lib/store";
import { firstInstituteId } from "@/lib/helpers";
import { createEventAction, updateEventAction, addEventMediaAction } from "@/lib/actions";
import MediaUploadForm from "@/components/MediaUploadForm";
import { mediaUploadLabels } from "@/lib/media-i18n";
import { MAX_EVENT_ATTACHMENT_BYTES, MAX_VIDEO_DURATION_SECONDS } from "@/lib/media-limits";
import { signedUrlsForRefs } from "@/lib/storage";
import { i18nForAccount } from "@/lib/i18n-session";
import { fmtTimeFor, tr } from "@/lib/i18n";
import { recordToolUsage } from "@/lib/tool-usage";

export const dynamic = "force-dynamic";

// KID-221: the events creator page was English-only inside an Arabic shell.
// Event dates (DB rows like "saturday") come through in the active locale
// via a weekday-map, so the card badge stops leaking English day names.
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export default async function PortalEventsPage({ searchParams }: { searchParams: Promise<{ open?: string; error?: string; edit?: string }> }) {
  const session = await requireSession();
  const { locale, dict } = await i18nForAccount(session.accountId);
  const t = (key: string, vars?: Record<string, string | number>) => tr(dict, key, vars);
  const instituteId = await firstInstituteId();
  if (!instituteId) return <p className="muted">{t("events.noInstitute")}</p>;
  await recordToolUsage({ instituteId: String(instituteId ?? "") || null, accountId: session.accountId, toolKey: "events", source: "portal", metadata: null });
  // KID-2480 (founder rule): admins/owner see every room and may post a
  // whole-center event; teachers/caregivers see only their assigned rooms and
  // can never post center-wide. The list is filtered to the same audience.
  const canManageAll = canTargetWholeCenter(session.role);
  const [events, allRooms, allowedRoomIds] = await Promise.all([
    listEvents(instituteId, false, { viewerAccountId: session.accountId, viewerRole: session.role }),
    listRooms(instituteId),
    eventAudienceRoomIds(instituteId, session.accountId, session.role),
  ]);
  const rooms = canManageAll
    ? allRooms
    : allRooms.filter((r: any) => (allowedRoomIds ?? []).includes(String(r.id)));
  const withMedia = await Promise.all(events.map(async (e: any) => ({ ...e, media: await eventMedia(e.id) })));
  // KID-2466: private media rows keep a REF; sign them for this authorized view.
  const mediaSrcs = await signedUrlsForRefs(
    withMedia.flatMap((e: any) => e.media.map((m: any) => String(m.url ?? "")))
  );
  const params = await searchParams;
  const openId = params.open;
  const canEdit = (e: any) =>
    eventEditableBy(session.role, allowedRoomIds, e.classroom_id ? String(e.classroom_id) : null);
  const editing = params.edit
    ? (events.find((e: any) => String(e.id) === params.edit && canEdit(e)) as any)
    : undefined;
  const canCreate = canManageAll || rooms.length > 0;
  const weekdayLabel = (raw: unknown) => {
    const idx = WEEKDAYS.indexOf(String(raw ?? "").toLowerCase());
    if (idx < 0) return String(raw ?? "");
    const d = new Date(Date.UTC(2026, 9, 4 + idx));
    return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { weekday: "long" }).format(d);
  };

  return (
    <div>
      <h1 className="title">{t("events.title")}</h1>

      {params.error === "eventMedia" && (
        <div role="alert" className="card mb-4" style={{ borderInlineStart: "4px solid #b91c1c" }}>
          <p className="small" style={{ margin: 0 }}>{t("events.errorAttachment")}</p>
        </div>
      )}

      {params.error === "eventClass" && (
        <div role="alert" className="card mb-4" style={{ borderInlineStart: "4px solid #b91c1c" }}>
          <p className="small" style={{ margin: 0 }}>{t("events.errorClassPick")}</p>
        </div>
      )}

      {editing && (
        <div className="card mb-4">
          <h3 className="subtitle">{t("events.editTitle")}</h3>
          <form action={updateEventAction}>
            <input type="hidden" name="eventId" value={editing.id} />
            <div className="row">
              <div className="col field"><label className="label">{t("events.titleLabel")}</label><input className="input" name="title" defaultValue={editing.title} required /></div>
              <div className="col field"><label className="label">{t("events.dateLabel")}</label><input className="input" type="date" name="eventDate" defaultValue={editing.event_date} required /></div>
              <div className="col field"><label className="label">{t("events.startLabel")}</label><input className="input" type="time" name="startTime" defaultValue={String(editing.start_time ?? "").slice(0, 5)} /></div>
              <div className="col field"><label className="label">{t("events.endLabel")}</label><input className="input" type="time" name="endTime" defaultValue={String(editing.end_time ?? "").slice(0, 5)} /></div>
            </div>
            <div className="row">
              <div className="col field"><label className="label">{t("events.locationLabel")}</label><input className="input" name="location" defaultValue={editing.location ?? ""} placeholder={t("events.locationPlaceholder")} /></div>
              <div className="col field">
                <label className="label">{t("events.classLabel")}</label>
                <select className="select" name="classroomId" defaultValue={editing.classroom_id ?? ""} required={!canManageAll}>
                  {canManageAll && <option value="">{t("events.allClasses")}</option>}
                  {(rooms as any[]).map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
            </div>
            <div className="field"><label className="label">{t("events.descriptionLabel")}</label><textarea className="textarea" name="description" defaultValue={editing.description ?? ""} /></div>
            <div className="row">
              <button className="btn btn-primary" type="submit">{t("events.saveChanges")}</button>
              <Link className="btn btn-ghost" href="/portal/events">{t("events.cancel")}</Link>
            </div>
          </form>
        </div>
      )}

      {!editing && !canCreate && (
        <div className="card mb-4">
          <p className="small muted" style={{ margin: 0 }}>{t("events.noAssignedClass")}</p>
        </div>
      )}

      {!editing && canCreate && (
        <div className="card mb-4">
          <h3 className="subtitle">{t("events.addEvent")}</h3>
          <form action={createEventAction}>
            <div className="row">
              <div className="col field"><label className="label">{t("events.titleLabel")}</label><input className="input" name="title" required /></div>
              <div className="col field"><label className="label">{t("events.dateLabel")}</label><input className="input" type="date" name="eventDate" required /></div>
              <div className="col field"><label className="label">{t("events.startLabel")}</label><input className="input" type="time" name="startTime" /></div>
              <div className="col field"><label className="label">{t("events.endLabel")}</label><input className="input" type="time" name="endTime" /></div>
            </div>
            <div className="row">
              <div className="col field"><label className="label">{t("events.locationLabel")}</label><input className="input" name="location" placeholder={t("events.locationPlaceholder")} /></div>
              <div className="col field">
                <label className="label">{t("events.classLabel")}</label>
                <select className="select" name="classroomId" defaultValue="" required={!canManageAll}>
                  {canManageAll && <option value="">{t("events.allClasses")}</option>}
                  {(rooms as any[]).map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
            </div>
            <div className="field"><label className="label">{t("events.descriptionLabel")}</label><textarea className="textarea" name="description" /></div>
            <button className="btn btn-primary" type="submit">{t("events.addBtn")}</button>
          </form>
        </div>
      )}

      <div className="grid">
        {withMedia.map((e: any) => (
          <div className="card" key={e.id}>
            <div className="status-card">
              <div>
                <span className="badge">{weekdayLabel(e.event_date)}</span>
                {e.classroom_name && <span className="badge" style={{ marginInlineStart: 6 }}>{e.classroom_name}</span>}
              </div>
              <div className="row" style={{ gap: 8, alignItems: "center" }}>
                <div className="muted small">{t("events.mediaCount", { count: e.media_count })}</div>
                {canEdit(e) && (
                  <Link className="small" href={`/portal/events?edit=${e.id}`} style={{ fontWeight: 600 }}>{t("events.edit")}</Link>
                )}
              </div>
            </div>
            <div style={{ fontWeight: 700, fontSize: 17, marginTop: 8 }}>{e.title}</div>
            {e.start_time && <div className="muted small">{fmtTimeFor(locale, e.start_time)}{e.end_time ? ` – ${fmtTimeFor(locale, e.end_time)}` : ""}</div>}
            {e.location && <div className="muted small">📍 {e.location}</div>}
            {e.description && <p className="small mt-2">{e.description}</p>}
            {/* KID-2466: the upload form was previously reachable only by
                hand-building ?open=; staff need a visible control. */}
            <div className="row mt-2" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <Link
                className="btn btn-ghost small"
                href={openId === e.id ? "/portal/events" : `/portal/events?open=${e.id}#event-media-${e.id}`}
              >
                {openId === e.id ? t("events.closeAttach") : t("events.attach")}
              </Link>
            </div>
            {e.media.length > 0 && (
              <div className="row mt-2">
                {e.media.map((m: any) => {
                  // A REF that could not be signed is never rendered raw.
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
                        style={{ width: 120, height: 90, objectFit: "cover", borderRadius: 8 }}
                      />
                    );
                  }
                  return (
                    <a key={m.id} href={src} target="_blank" rel="noreferrer">
                      <img src={src} alt={m.caption ?? e.title} width={80} height={60} style={{ objectFit: "cover", borderRadius: 8 }} />
                    </a>
                  );
                })}
              </div>
            )}
            {openId === e.id && (
              <MediaUploadForm
                action={addEventMediaAction}
                className="mt-3 row"
                style={{ gap: 8, alignItems: "flex-end" }}
                encType="multipart/form-data"
                maxImageBytes={MAX_EVENT_ATTACHMENT_BYTES}
                maxVideoBytes={MAX_EVENT_ATTACHMENT_BYTES}
                maxVideoSeconds={MAX_VIDEO_DURATION_SECONDS}
                labels={mediaUploadLabels(dict)}
                directUpload={{ purpose: "event", fileField: "attachment" }}
              >
                <input type="hidden" name="eventId" value={e.id} />
                <div className="field" style={{ flex: 1 }}>
                  <label className="label" htmlFor={`event-media-${e.id}`}>{t("events.attachmentDevice")}</label>
                  <input
                    id={`event-media-${e.id}`}
                    className="input"
                    type="file"
                    name="attachment"
                    accept="image/*,video/*"
                  />
                  <span className="small muted">{t("events.attachmentLimit")}</span>
                </div>
                <button className="btn btn-ghost" type="submit">{t("events.attach")}</button>
              </MediaUploadForm>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
