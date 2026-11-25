import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/require";
import { staffIdForAccount } from "@/lib/auth";
import { isAdminRole } from "@/lib/role";
import { getRoom, roomChildren, staffRooms } from "@/lib/store";
import { firstInstituteId } from "@/lib/helpers";
import { updateRoomAction, uploadRoomPhotoAction, removeRoomPhotoAction } from "@/lib/actions";
import { i18nForAccount } from "@/lib/i18n-session";
import { tr } from "@/lib/i18n";
import { storageSrcFor } from "@/lib/storage";
import { MAX_PHOTO_UPLOAD_BYTES } from "@/lib/media-limits";
import { mediaUploadLabels } from "@/lib/media-i18n";
import MediaUploadForm from "@/components/MediaUploadForm";

export const dynamic = "force-dynamic";

export default async function PortalRoomDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ error?: string }>;
}) {
  const session = await requireSession();
  const { dict } = await i18nForAccount(session.accountId);
  const room = await getRoom((await params).id);
  if (!room) notFound();
  // KID-372: the raw room id in the URL is not authorization — admins could
  // open and list the children of ANOTHER center's room. The room must
  // belong to the request tenant; the legacy first-institute fallback
  // (empty instance id) never renders tenant data.
  const requestIid = await firstInstituteId();
  if (!requestIid || String(room.institute_id ?? "") !== requestIid) notFound();

  // KID-105 #16: staff can only open rooms they are assigned to.
  if (!isAdminRole(session.role)) {
    const myStaffId = await staffIdForAccount(session.accountId);
    const assigned = myStaffId ? await staffRooms(myStaffId) : [];
    const allowed = new Set(assigned.map((r) => String(r.id)));
    if (!allowed.has(String(room.id))) notFound();
  }

  const children = await roomChildren(room.id);
  const canEdit = isAdminRole(session.role);
  const photoSrc = await storageSrcFor(room.photo_url);
  const photoError = (await searchParams)?.error;

  return (
    <div>
      <Link className="small muted" href="/portal/rooms">← {tr(dict, "rooms.title")}</Link>
      {photoError === "photoType" || photoError === "photoSize" ? (
        <div role="alert" className="card mt-3" style={{ borderLeft: "4px solid #b91c1c" }}>
          <p className="small" style={{ margin: 0 }}>{tr(dict, "rooms.photoError")}</p>
        </div>
      ) : null}
      <div className="row mt-2" style={{ alignItems: "center", gap: 12 }}>
        {photoSrc ? (
          // KID-2481: the room photo replaces the colour dot when present.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photoSrc}
            alt={String(room.name ?? "")}
            width={48}
            height={48}
            style={{ width: 48, height: 48, borderRadius: 12, objectFit: "cover" }}
          />
        ) : (
          <span className="room-dot" style={{ background: String(room.colour ?? "#3B82F6"), width: 16, height: 16 }} />
        )}
        <h1 className="title" style={{ marginBottom: 0 }}>{room.name}</h1>
      </div>
      <p className="subtitle">{tr(dict, "rooms.capacityOf", { n: room.capacity ?? "—" })}</p>

      <div className="grid">
        <div className="card">
          <h3 className="subtitle">{tr(dict, "roomDetail.assignedChildren")}</h3>
          {children.length === 0 ? (
            <p className="muted small">{tr(dict, "roomDetail.empty")}</p>
          ) : (
            children.map((c: any) => (
              <div className="list-item" key={c.id}>
                <Link href={`/portal/children/${c.id}`} style={{ fontWeight: 600 }}>
                  {c.first_name} {c.last_name}
                </Link>
                <span className="muted small">{c.dob ?? ""}</span>
              </div>
            ))
          )}
          <div className="small muted mt-3">
            {tr(dict, "roomDetail.assignHint")}
          </div>
        </div>

        {canEdit && (
          <div className="card">
            <h3 className="subtitle">{tr(dict, "roomDetail.roomSettings")}</h3>
            <form action={updateRoomAction}>
              <input type="hidden" name="roomId" value={room.id as string} />
              <div className="field"><label className="label">{tr(dict, "common.name")}</label><input className="input" name="name" required defaultValue={String(room.name)} /></div>
              <div className="field"><label className="label">{tr(dict, "rooms.capacity")}</label><input className="input" name="capacity" type="number" defaultValue={String(room.capacity ?? "")} /></div>
              <div className="field"><label className="label">{tr(dict, "rooms.colour")}</label><input className="input" name="colour" type="color" defaultValue={String(room.colour ?? "#3B82F6")} /></div>
              <button className="btn btn-primary" type="submit">{tr(dict, "roomDetail.saveSettings")}</button>
            </form>

            <div className="mt-4">
              <h3 className="subtitle">{tr(dict, "rooms.photo")}</h3>
              <MediaUploadForm
                action={uploadRoomPhotoAction}
                maxImageBytes={MAX_PHOTO_UPLOAD_BYTES}
                labels={mediaUploadLabels(dict)}
                style={{ display: "flex", gap: 8, alignItems: "center" }}
                directUpload={{ purpose: "photo", entityType: "room", entityId: room.id as string }}
              >
                <input type="hidden" name="roomId" value={room.id as string} />
                <input type="file" name="file" accept="image/*" required id={`room-photo-${room.id}`} style={{ display: "none" }} />
                <label htmlFor={`room-photo-${room.id}`} className="btn btn-ghost" style={{ cursor: "pointer", fontSize: 13 }}>
                  {room.photo_url ? tr(dict, "rooms.changePhoto") : tr(dict, "rooms.addPhoto")}
                </label>
                <button className="btn btn-primary" type="submit" style={{ fontSize: 13 }}>{tr(dict, "profile.save")}</button>
              </MediaUploadForm>
              {room.photo_url ? (
                <form action={removeRoomPhotoAction} style={{ marginTop: 8 }}>
                  <input type="hidden" name="roomId" value={room.id as string} />
                  <button className="btn btn-ghost" type="submit" style={{ fontSize: 13 }}>{tr(dict, "rooms.removePhoto")}</button>
                </form>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
