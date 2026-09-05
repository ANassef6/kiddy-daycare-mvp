import { requireSession } from "@/lib/require";
import { familiesForAccount, driveFilesFor } from "@/lib/store";
import { cap } from "@/lib/helpers";

export const dynamic = "force-dynamic";

export default async function ParentDrivePage() {
  const session = requireSession();
  const families = await familiesForAccount(session.accountId);
  const all = await Promise.all(
    families.map(async (c: any) => ({ childId: c.id, files: await driveFilesFor(c.institute_id, c.id) }))
  );
  const files = all.flatMap((f: any) => f.files);

  return (
    <div>
      <h1 className="title">Parent drive</h1>
      <div className="subtitle">Documents, forms, and media shared with your family by the daycare.</div>
      {files.length === 0 && <p className="muted">Nothing shared yet.</p>}
      {files.map((f: any) => (
        <div className="list-item" key={f.id}>
          <div>
            <div style={{ fontWeight: 600 }}>
              <a href={f.url} target="_blank" rel="noreferrer">{f.filename}</a>
            </div>
            <div className="muted small">
              {cap(f.kind)}{f.size_bytes ? ` · ${(f.size_bytes / 1024).toFixed(0)} KB` : ""}
              {f.first_name ? ` · ${f.first_name} ${f.last_name}` : " · all children"}
              {f.description ? ` · ${f.description}` : ""}
            </div>
          </div>
          <a className="btn btn-ghost small" href={f.url} target="_blank" rel="noreferrer">Open</a>
        </div>
      ))}
    </div>
  );
}