import { requireFamilyPage } from "@/lib/require";
import { familiesForAccount } from "@/lib/store";
import { queryAll } from "@/lib/db";
import { respondConsentAction } from "@/lib/actions";
import { i18nForAccount } from "@/lib/i18n-session";
import { tr } from "@/lib/i18n";

export const dynamic = "force-dynamic";

// KID-221: the parent's consents page (approve/deny) was English-only inside
// the translated Arabic shell. Localized; status labels shared with the
// staff's consents page.
export default async function ParentConsentsPage() {
  const session = await requireFamilyPage("/child/consents");
  const { dict } = await i18nForAccount(session.accountId);
  const t = (key: string, vars?: Record<string, string | number>) => tr(dict, key, vars);
  const families = await familiesForAccount(session.accountId);
  const childIds = families.map((f) => f.id as string);
  const consents = childIds.length
    ? await queryAll(
        `SELECT cr.*, c.first_name FROM consent_request cr
         LEFT JOIN child c ON c.id = cr.child_id
         WHERE cr.child_id IN (${childIds.map(() => "?").join(",")})
         ORDER BY cr.created_at DESC`,
        ...childIds
      )
    : [];
  const statusLabel = (status: string) =>
    status === "approved"
      ? t("consents.statusApproved")
      : status === "denied"
        ? t("consents.statusDenied")
        : t("consents.statusPending");

  return (
    <div>
      <h1 className="title">{t("consents.approvalsTitle")}</h1>
      {consents.length === 0 ? (
        <p className="muted">{t("consents.noRequests")}</p>
      ) : (
        consents.map((c: any) => (
          <div className="card mb-4" key={c.id}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>
                <div style={{ fontWeight: 700 }}>{c.title}</div>
                <div className="muted small">{c.first_name}</div>
              </div>
              <span className={c.status === "approved" ? "badge badge-green" : c.status === "denied" ? "badge badge-red" : "badge"}>
                {statusLabel(String(c.status))}
              </span>
            </div>
            {c.body && <p className="mt-2">{c.body}</p>}
            {c.status === "pending" && (
              <form className="row mt-3" action={respondConsentAction}>
                <input type="hidden" name="id" value={c.id} />
                <button className="btn btn-accent" name="status" value="approved" type="submit">{t("consents.approve")}</button>
                <button className="btn btn-ghost" name="status" value="denied" type="submit">{t("consents.deny")}</button>
              </form>
            )}
          </div>
        ))
      )}
    </div>
  );
}
