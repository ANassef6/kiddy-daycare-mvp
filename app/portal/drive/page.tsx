import { requireSession } from "@/lib/require";
import { listDriveFiles, listChildren } from "@/lib/store";
import { firstInstituteId, cap } from "@/lib/helpers";
import { addDriveFileAction } from "@/lib/actions";

export const dynamic = "force-dynamic";

export default async function PortalDrivePage() {
  requireSession();
  const instituteId = await firstInstituteId();
  if (!instituteId) return <p className="muted">No institute configured.</p>;
  const [files, children] = await Promise.all([listDriveFiles(instituteId), listChildren(instituteId)]);

  return (
    <div>
      <h1 className="title">Parent drive</h1>
      <div className="subtitle">Share files with a family (a child) or with all families.</div>

      <div className="card mb-4">
        <h3 className="subtitle">Share a file</h3>
        <form action={addDriveFileAction}>
          <div className="row">
            <div className="col field"><label className="label">File name</label><input className="input" name="filename" required placeholder="e.g. Handbook 2026.pdf" /></div>
            <div className="col field"><label className="label">File URL</label><input className="input" name="url" required placeholder="https://…" /></div>
            <div className="col field">
              <label className="label">Type</label>
              <select className="select" name="kind"><option value="file">File</option><option value="pdf">PDF</option><option value="photo">Photo</option><option value="video">Video</option></select>
            </div>
          </div>
          <div className="row">
            <div className="col field">
              <label className="label">Share with</label>
              <select className="select" name="childId">
                <option value="">All families</option>
                {children.map((c: any) => <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>)}
              </select>
            </div>
            <div className="col field"><label className="label">Size (bytes, optional)</label><input className="input" type="number" name="sizeBytes" /></div>
          </div>
          <div className="field"><label className="label">Description</label><input className="input" name="description" /></div>
          <button className="btn btn-primary" type="submit">Share file</button>
        </form>
      </div>

      <div className="card">
        <h3 className="subtitle">Shared files</h3>
        {files.length === 0 && <p className="muted small">Nothing shared yet.</p>}
        {files.map((f: any) => (
          <div className="list-item" key={f.id}>
            <div>
              <div style={{ fontWeight: 600 }}><a href={f.url} target="_blank" rel="noreferrer">{f.filename}</a></div>
              <div className="muted small">
                {cap(f.kind)}{f.size_bytes ? ` · ${(f.size_bytes / 1024).toFixed(0)} KB` : ""} ·{" "}
                {f.first_name ? `${f.first_name} ${f.last_name}` : "all families"}{f.description ? ` — ${f.description}` : ""} · by {f.uploaded_by ?? "—"}
              </div>
            </div>
            <a className="btn btn-ghost small" href={f.url} target="_blank" rel="noreferrer">Open</a>
          </div>
        ))}
      </div>
    </div>
  );
}