import { requireSession } from "@/lib/require";
import { listDriveFiles, listChildren } from "@/lib/store";
import { firstInstituteId } from "@/lib/helpers";
import { addDriveFileAction } from "@/lib/actions";
import { recordToolUsage } from "@/lib/tool-usage";
import { i18nForAccount } from "@/lib/i18n-session";
import { tr, type Dict } from "@/lib/i18n";
import MediaUploadForm from "@/components/MediaUploadForm";
import { mediaUploadLabels } from "@/lib/media-i18n";
import { MAX_DRIVE_FILE_BYTES, MAX_VIDEO_DURATION_SECONDS } from "@/lib/media-limits";

export const dynamic = "force-dynamic";

export default async function PortalDrivePage(props: {
  searchParams?: Promise<{ error?: string }>;
}) {
  const searchParams = props.searchParams;
  const session = await requireSession();
  const params = (await searchParams) ?? {};
  const { dict } = await i18nForAccount(session.accountId);
  const instituteId = await firstInstituteId();
  if (!instituteId) return <p className="muted">{tr(dict, "learning.noInstitute")}</p>;
  await recordToolUsage({ instituteId: String(instituteId ?? "") || null, accountId: session.accountId, toolKey: "drive", source: "portal", metadata: null });
  // KID-103: drive lists and share-with dropdown are scoped to assigned classrooms.
  const [files, children] = await Promise.all([
    listDriveFiles(instituteId, session.accountId),
    listChildren(instituteId, { accountId: session.accountId }),
  ]);

  return (
    <div>
      <h1 className="title">{tr(dict, "drive.title")}</h1>
      <div className="subtitle">{tr(dict, "driveAdmin.subtitle")}</div>

      {params.error === "attachment" && (
        <div role="alert" className="card mb-4" style={{ borderLeft: "4px solid #b91c1c" }}>
          <p className="small" style={{ margin: 0 }}>{tr(dict, "drive.errorAttachment")}</p>
        </div>
      )}

      <div className="card mb-4">
        <h3 className="subtitle">{tr(dict, "driveAdmin.shareFileHeading")}</h3>
        <MediaUploadForm
          action={addDriveFileAction}
          encType="multipart/form-data"
          maxImageBytes={MAX_DRIVE_FILE_BYTES}
          maxVideoBytes={MAX_DRIVE_FILE_BYTES}
          maxVideoSeconds={MAX_VIDEO_DURATION_SECONDS}
          maxFileBytes={MAX_DRIVE_FILE_BYTES}
          labels={mediaUploadLabels(dict)}
        >
          <div className="row">
            <div className="col field"><label className="label">{tr(dict, "driveAdmin.fileNameLabel")}</label><input className="input" name="filename" placeholder={tr(dict, "driveAdmin.fileNamePlaceholder")} /></div>
            <div className="col field"><label className="label">{tr(dict, "driveAdmin.chooseFromDevice")}</label><input className="input" type="file" name="file" required /></div>
            <div className="col field">
              <label className="label">{tr(dict, "driveAdmin.typeLabel")}</label>
              <select className="select" name="kind"><option value="file">{tr(dict, "drive.kindFile")}</option><option value="pdf">{tr(dict, "drive.kindPdf")}</option><option value="photo">{tr(dict, "drive.kindPhoto")}</option><option value="video">{tr(dict, "drive.kindVideo")}</option></select>
            </div>
          </div>
          <div className="row">
            <div className="col field">
              <label className="label">{tr(dict, "driveAdmin.shareWith")}</label>
              <select className="select" name="childId">
                <option value="">{tr(dict, "driveAdmin.allFamilies")}</option>
                {children.map((c: any) => <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>)}
              </select>
            </div>
          </div>
          <div className="field"><label className="label">{tr(dict, "common.description")}</label><input className="input" name="description" /></div>
          <button className="btn btn-primary" type="submit">{tr(dict, "driveAdmin.shareFileBtn")}</button>
        </MediaUploadForm>
      </div>

      <div className="card">
        <h3 className="subtitle">{tr(dict, "driveAdmin.sharedFiles")}</h3>
        {files.length === 0 && <p className="muted small">{tr(dict, "drive.empty")}</p>}
        {files.map((f: any) => (
          <div className="list-item" key={f.id}>
            <div>
              <div style={{ fontWeight: 600 }}><a href={f.url} target="_blank" rel="noreferrer">{f.filename}</a></div>
              <div className="muted small">
                {kindLabel(dict, f.kind)}{f.size_bytes ? ` · ${tr(dict, "driveAdmin.kb", { kb: (f.size_bytes / 1024).toFixed(0) })}` : ""} ·{" "}
                {f.first_name ? `${f.first_name} ${f.last_name}` : tr(dict, "driveAdmin.sharedWithAll")}{f.description ? ` — ${f.description}` : ""} · {tr(dict, "driveAdmin.by", { name: f.uploaded_by ?? "—" })}
              </div>
            </div>
            <a className="btn btn-ghost small" href={f.url} target="_blank" rel="noreferrer">{tr(dict, "drive.open")}</a>
          </div>
        ))}
      </div>
    </div>
  );
}

function kindLabel(dict: Dict, kind: unknown) {
  const v = String(kind ?? "file");
  const key = v === "pdf" ? "drive.kindPdf" : v === "photo" ? "drive.kindPhoto" : v === "video" ? "drive.kindVideo" : "drive.kindFile";
  return tr(dict, key);
}