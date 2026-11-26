import { requireSession } from "@/lib/require";
import { resolveTenantInstituteId } from "@/lib/tenant";
import { listConsents, listChildren, listRooms, staffRooms } from "@/lib/store";
import { createConsentAction } from "@/lib/actions";
import { i18nForAccount } from "@/lib/i18n-session";
import { fmtDateTimeFor, tr } from "@/lib/i18n";
import Attribution from "@/components/Attribution";
import ConsentAudiencePicker from "@/components/ConsentAudiencePicker";
import { queryGet } from "@/lib/db";
import { recordToolUsage } from "@/lib/tool-usage";

export const dynamic = "force-dynamic";

// KID-221: this was the last surface where the consent workflow only existed
// in English (the whole form, statuses and dates). Localized end-to-end; the
// status labels are shared with the parent's approve/deny page.
export default async function PortalConsentsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const session = await requireSession();
  const { locale, dict } = await i18nForAccount(session.accountId);
  const t = (key: string, vars?: Record<string, string | number>) => tr(dict, key, vars);
  const iid = await resolveTenantInstituteId();
  await recordToolUsage({ instituteId: String(iid ?? "") || null, accountId: session.accountId, toolKey: "consents", source: "portal", metadata: null });
  // KID-103: child picker scoped to assigned classrooms.
  // KID-2494: classroom targeting reuses the same room list and scope rules as
  // the other recipient pickers.
  const [consents, children, rooms] = await Promise.all([
    iid ? listConsents(iid) : Promise.resolve([]),
    iid ? listChildren(iid, { accountId: session.accountId }) : Promise.resolve([]),
    iid ? listRooms(iid) : Promise.resolve([]),
  ]);
  let assignedRoomIds: string[] = [];
  if (session.role === "staff" || session.role === "carer") {
    const me = await queryGet("SELECT staff_id FROM account WHERE id = ?", session.accountId);
    if (me?.staff_id) {
      assignedRoomIds = (await staffRooms(String(me.staff_id))).map((r) => String(r.id));
    }
  }
  const statusLabel = (status: string) =>
    status === "approved"
      ? t("consents.statusApproved")
      : status === "denied"
        ? t("consents.statusDenied")
        : t("consents.statusPending");
  const consentAudience = (c: any) =>
    c.child_first_name
      ? `${c.child_first_name} ${c.child_last_name ?? ""}`.trim()
      : t("consents.childAll");

  return (
    <div>
      <h1 className="title">{t("consents.title")}</h1>
      {params.error === "audience" && (
        <p className="badge badge-red mb-4" role="alert">{t("consents.errorAudience")}</p>
      )}
      <form className="card mb-4" action={createConsentAction}>
        <h3 className="subtitle">{t("consents.newConsent")}</h3>
        <div className="row">
          <div className="col field"><label className="label">{t("consents.titleLabel")}</label><input className="input" name="title" required /></div>
          <div className="col field"><label className="label">{t("consents.audience")}</label>
            <ConsentAudiencePicker
              dict={dict}
              childOptions={children.map((c: any) => ({
                id: String(c.id),
                first_name: String(c.first_name),
                last_name: String(c.last_name),
                room_id: c.room_id ? String(c.room_id) : null,
                room_name: c.room_name ? String(c.room_name) : null,
              }))}
              rooms={rooms.map((r) => ({ id: String(r.id), name: String(r.name) }))}
              role={session.role}
              assignedRoomIds={assignedRoomIds}
            />
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
              <div className="muted small">{consentAudience(c)} · {fmtDateTimeFor(locale, c.created_at)}</div>
              <Attribution locale={locale} createdBy={c.created_by_name ?? null} createdAt={c.created_at ?? null} />
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
