import { requireSession } from "@/lib/require";
import { resolveTenantInstituteId } from "@/lib/tenant";
import { listConsents, listChildren } from "@/lib/store";
import { createConsentAction } from "@/lib/actions";
import { i18nForAccount } from "@/lib/i18n-session";
import { fmtDateTimeFor, tr } from "@/lib/i18n";

export const dynamic = "force-dynamic";

// KID-221: this was the last surface where the consent workflow only existed
// in English (the whole form, statuses and dates). Localized end-to-end; the
// status labels are shared with the parent's approve/deny page.
export default async function PortalConsentsPage() {
  const session = requireSession();
  const { locale, dict } = await i18nForAccount(session.accountId);
  const t = (key: string, vars?: Record<string, string | number>) => tr(dict, key, vars);
  const iid = await resolveTenantInstituteId();
  // KID-103: child picker scoped to assigned classrooms.
  const [consents, children] = await Promise.all([
    iid ? listConsents(iid) : Promise.resolve([]),
    iid ? listChildren(iid, { accountId: session.accountId }) : Promise.resolve([]),
  ]);
  const statusLabel = (status: string) =>
    status === "approved"
      ? t("consents.statusApproved")
      : status === "denied"
        ? t("consents.statusDenied")
        : t("consents.statusPending");

  return (
    <div>
      <h1 className="title">{t("consents.title")}</h1>
      <form className="card mb-4" action={createConsentAction}>
        <h3 className="subtitle">{t("consents.newConsent")}</h3>
        <div className="row">
          <div className="col field"><label className="label">{t("consents.titleLabel")}</label><input className="input" name="title" required /></div>
          <div className="col field"><label className="label">{t("consents.childOptional")}</label>
            <select className="select" name="childId">
              <option value="">{t("consents.childAll")}</option>
              {children.map((c: any) => <option key={c.id} value={String(c.id)}>{c.first_name} {c.last_name}</option>)}
            </select>
          </div>
        </div>
        <div className="field"><label className="label">{t("consents.details")}</label><textarea className="textarea" name="body" /></div>
        <button className="btn btn-primary" type="submit">{t("consents.send")}</button>
      </form>

      {consents.length === 0 ? (
        <p className="muted small">{t("consents.noConsents")}</p>
      ) : (
        consents.map((c: any) => (
          <div className="list-item" key={c.id}>
            <div>
              <div style={{ fontWeight: 600 }}>{c.title}</div>
              <div className="muted small">{fmtDateTimeFor(locale, c.created_at)}</div>
            </div>
            <span className={
              c.status === "approved" ? "badge badge-green" : c.status === "denied" ? "badge badge-red" : "badge"
            }>
              {statusLabel(String(c.status))}
            </span>
          </div>
        ))
      )}
    </div>
  );
}
