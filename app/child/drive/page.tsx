import { requireFamilyPage } from "@/lib/require";
import { familiesForAccount, driveFilesFor } from "@/lib/store";
import { i18nForAccount } from "@/lib/i18n-session";
import { tr } from "@/lib/i18n";

export const dynamic = "force-dynamic";

// KID-221: the parent drive page was English-only — heading, subtitle,
// "Nothing shared yet.", the "Open" action, the "all children" tag and the
// bucket-size suffix. Localized; the shared-with tag follows the locale.
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
      <h1 className="title">{t("nav.parentDrive")}</h1>
      <div className="subtitle">{t("parent.driveSubtitle")}</div>
      {files.length === 0 && <p className="muted">{t("parent.driveNothing")}</p>}
      {files.map((f: any) => (
        <div className="list-item" key={f.id}>
          <div>
            <div style={{ fontWeight: 600 }}>
              <a href={f.url} target="_blank" rel="noreferrer">{f.filename}</a>
            </div>
            <div className="muted small">
              {String(f.kind ?? "")}
              {f.size_bytes ? ` · ${t("parent.driveKb", { kb: (f.size_bytes / 1024).toFixed(0) })}` : ""}
              {f.first_name ? ` · ${f.first_name} ${f.last_name}` : ` · ${t("parent.driveAllChildren")}`}
              {f.description ? ` · ${f.description}` : ""}
            </div>
          </div>
          <a className="btn btn-ghost small" href={f.url} target="_blank" rel="noreferrer">{t("parent.driveOpen")}</a>
        </div>
      ))}
    </div>
  );
}
