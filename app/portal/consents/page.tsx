import Link from "next/link";
import { requireSession } from "@/lib/require";
import { resolveTenantInstituteId } from "@/lib/tenant";
import { listConsentBatches, listConsentBatchRooms, listRooms, staffRooms } from "@/lib/store";
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
// KID-2494: the form targets All / general or classrooms (no per-child picker).
// Every send gets a recipient list with each child's response, so the list is
// one row per send and opens /portal/consents/[batchId].
export default async function PortalConsentsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const session = await requireSession();
  const { locale, dict, timeZone } = await i18nForAccount(session.accountId);
  const t = (key: string, vars?: Record<string, string | number>) => tr(dict, key, vars);
  const iid = await resolveTenantInstituteId();
  await recordToolUsage({ instituteId: String(iid ?? "") || null, accountId: session.accountId, toolKey: "consents", source: "portal", metadata: null });
  // KID-103: classroom picker scoped to assigned classrooms.
  // KID-2494: classroom targeting reuses the same room list and scope rules as
  // the other recipient pickers.
  const [batches, batchRooms, rooms] = await Promise.all([
    iid ? listConsentBatches(iid) : Promise.resolve([]),
    iid ? listConsentBatchRooms(iid) : Promise.resolve([]),
    iid ? listRooms(iid) : Promise.resolve([]),
  ]);
  const roomNamesByBatch = new Map<string, string[]>();
  for (const row of batchRooms) {
    const key = String(row.batch_id);
    const names = roomNamesByBatch.get(key) ?? [];
    names.push(String(row.room_name));
    roomNamesByBatch.set(key, names);
  }
  let assignedRoomIds: string[] = [];
  if (session.role === "staff" || session.role === "carer") {
    const me = await queryGet("SELECT staff_id FROM account WHERE id = ?", session.accountId);
    if (me?.staff_id) {
      assignedRoomIds = (await staffRooms(String(me.staff_id))).map((r) => String(r.id));
    }
  }

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
              rooms={rooms.map((r) => ({ id: String(r.id), name: String(r.name) }))}
              role={session.role}
              assignedRoomIds={assignedRoomIds}
            />
          </div>
        </div>
        <div className="field"><label className="label">{t("consents.details")}</label><textarea className="textarea" name="body" /></div>
        <button className="btn btn-primary" type="submit">{t("consents.send")}</button>
      </form>

      {batches.length === 0 ? (
        <p className="muted small">{t("consents.noConsents")}</p>
      ) : (
        batches.map((b: any) => {
          const answered = Number(b.approved ?? 0) + Number(b.denied ?? 0);
          const pending = Number(b.pending ?? 0);
          const roomNames = roomNamesByBatch.get(String(b.batch_id)) ?? [];
          const audience = Number(b.general_count ?? 0) > 0
            ? t("consents.generalAudience")
            : roomNames.join(", ");
          return (
            <Link
              key={String(b.batch_id)}
              href={`/portal/consents/${encodeURIComponent(String(b.batch_id))}`}
              className="list-item"
              style={{ textDecoration: "none", color: "inherit" }}
            >
              <div>
                <div style={{ fontWeight: 600 }}>{b.title}</div>
                <div className="muted small">{audience} · {fmtDateTimeFor(locale, b.created_at, timeZone)}</div>
                <div className="muted small">{t("consents.answeredPending", { answered, pending })}</div>
                <Attribution locale={locale} timeZone={timeZone} createdBy={b.created_by_name ?? null} createdAt={b.created_at ?? null} />
              </div>
              <span className="badge">{t("consents.viewRecipients")}</span>
            </Link>
          );
        })
      )}
    </div>
  );
}
