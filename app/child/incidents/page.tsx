import { requireFamilyPage } from "@/lib/require";
import { familiesForAccount, incidentsForChild } from "@/lib/store";
import { acknowledgeIncidentAction } from "@/lib/actions";
import { i18nForAccount } from "@/lib/i18n-session";
import { fmtDateTimeFor, tr } from "@/lib/i18n";

export const dynamic = "force-dynamic";

// KID-221: the parent's incident reports were English-only — heading, empty
// state, "Acknowledged"/"Pending acknowledgement" chips, the Acknowledge
// action and the always-English toLocaleString timestamp. Localized; the
// incident type ("Incident"/"Accident") uses the profile dictionaries.
export default async function ParentIncidentsPage() {
  const session = await requireFamilyPage("/child/incidents");
  const { locale, dict } = await i18nForAccount(session.accountId);
  const t = (key: string, vars?: Record<string, string | number>) => tr(dict, key, vars);
  const families = await familiesForAccount(session.accountId);
  const incidents: any[] = [];
  for (const f of families) {
    for (const i of await incidentsForChild(f.id as string)) {
      incidents.push({ ...i, child: `${(f as any).first_name} ${(f as any).last_name}` });
    }
  }
  incidents.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const typeLabel = (type: string) => {
    if (!type) return "—";
    const v = tr(dict, type === "accident" ? "profile.accident" : "profile.incident");
    return v || type;
  };

  return (
    <div>
      <h1 className="title">{t("child.incidentReports")}</h1>
      {incidents.length === 0 ? (
        <p className="muted">{t("parent.incidentsNothing")}</p>
      ) : (
        incidents.map((i: any) => (
          <div className="card mb-4" key={i.id}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div className="small muted">
                {typeLabel(String(i.type ?? ""))} · {i.child} · {fmtDateTimeFor(locale, i.created_at)}
              </div>
              <span className={i.acknowledged ? "badge badge-green" : "badge badge-red"}>
                {i.acknowledged ? t("child.acknowledged") : t("parent.incidentsPendingAck")}
              </span>
            </div>
            <p className="mt-2">{i.description}</p>
            {!i.acknowledged && (
              <form action={acknowledgeIncidentAction} className="mt-3">
                <input type="hidden" name="id" value={i.id} />
                <button className="btn btn-accent" type="submit">{t("profile.acknowledge")}</button>
              </form>
            )}
          </div>
        ))
      )}
    </div>
  );
}
