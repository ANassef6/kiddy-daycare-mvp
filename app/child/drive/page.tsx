import { requireFamilyPage } from "@/lib/require";
import { familiesForAccount, driveFilesFor } from "@/lib/store";
import { cap } from "@/lib/helpers";
import { i18nForAccount } from "@/lib/i18n-session";
import { tr } from "@/lib/i18n";

export const dynamic = "force-dynamic";

// KID-368 (DEF-004): localize the drive-file kind labels that come from the
// portal upload enum (file | pdf | photo | video); anything the daycare named
// itself keeps the capitalized raw kind.
function driveKindLabel(kind: string, t: (key: string) => string): string {
  switch (kind) {
    case "file": return t("drive.kindFile");
    case "pdf": return t("drive.kindPdf");
    case "photo": return t("drive.kindPhoto");
    case "video": return t("drive.kindVideo");
    default: return cap(kind);
  }
}

export default async function ParentDrivePage() {
  const session = await requireFamilyPage("/child/drive");
  const { dict } = await i18nForAccount(session.accountId);
  const t = (key: string, vars?: Record<string, string | number>) => tr(dict, key, vars);
  const families = await familiesForAccount(session.accountId);
  const all = await Promise.all(
    families.map(async (c: any) => ({ childId: c.id, files: await driveFilesFor(c.institute_id, c.id) }))
  );
  const files = all.flatMap((f: any) => f.files);

  return (
    <div>
      <h1 className="title">{t("drive.title")}</h1>
      <div className="subtitle">{t("drive.subtitle")}</div>
      {files.length === 0 && <p className="muted">{t("drive.empty")}</p>}
      {files.map((f: any) => (
        <div className="list-item" key={f.id}>
          <div>
            <div style={{ fontWeight: 600 }}>
              <a href={f.url} target="_blank" rel="noreferrer">{f.filename}</a>
            </div>
            <div className="muted small" dir="auto">
              {driveKindLabel(String(f.kind ?? "file"), t)}{f.size_bytes ? ` · ${(f.size_bytes / 1024).toFixed(0)} KB` : ""}
              {f.first_name ? ` · ${f.first_name} ${f.last_name}` : ` · ${t("drive.allChildren")}`}
              {f.description ? ` · ${f.description}` : ""}
            </div>
          </div>
          <a className="btn btn-ghost small" href={f.url} target="_blank" rel="noreferrer">{t("drive.open")}</a>
        </div>
      ))}
    </div>
  );
}
