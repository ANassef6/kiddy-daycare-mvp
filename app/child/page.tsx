import { requireSession } from "@/lib/require";
import {
  familiesForAccount,
  familyAccessForAccount,
  todayStatus,
  getPickupTime,
  pickupTimesForAccount,
} from "@/lib/store";
import { i18nForAccount } from "@/lib/i18n-session";
import { tr } from "@/lib/i18n";
import ChildCard from "@/components/ChildCard";
import PickupTimeForm from "@/components/PickupTimeForm";
import Avatar from "@/components/Avatar";
import { getBranding } from "@/lib/theme";
import { todayIso } from "@/lib/report-dates";

export const dynamic = "force-dynamic";

// KID-474: the saved/cancelled banner after the pickup actions land back here.
function PickupBanner({ saved, error, t }: { saved?: string; error?: string; t: (k: string, v?: Record<string, string | number>) => string }) {
  if (saved === "1") {
    return (
      <p className="badge badge-green" style={{ display: "inline-block" }}>
        {t("pickup.saved")}
      </p>
    );
  }
  if (saved === "cancelled") {
    return (
      <p className="badge badge-gray" style={{ display: "inline-block" }}>
        {t("pickup.removed")}
      </p>
    );
  }
  if (error) {
    const key = error === "checkin-disabled" ? "child.checkinDisabled" : null;
    return (
      <p
        className="small"
        style={{ background: "#fef3c7", border: "1px solid #f59e0b", borderRadius: 8, padding: "8px 12px" }}
      >
        {key ? t(key) : t("common.errorUnknown")}
      </p>
    );
  }
  return null;
}

export default async function MyChildrenPage({
  searchParams,
}: {
  searchParams: { saved?: string; error?: string };
}) {
  const session = requireSession();
  const { dict } = await i18nForAccount(session.accountId);
  const t = (key: string, vars?: Record<string, string | number>) => tr(dict, key, vars);
  const families = await familiesForAccount(session.accountId);

  if (families.length === 0) {
    return (
      <div className="card mt-5">
        <h1 className="title">{t("child.noChildrenLinked")}</h1>
        <p className="subtitle">
          {t("child.noChildrenHint")}
          <a className="mt-3 btn btn-primary" href="/register">{t("child.activateInvite")}</a>
        </p>
      </div>
    );
  }

  // KID-486: the effective access tier decides the page. Pickup links get the
  // minimal scheduling surface only — child name + photo, today's pickup
  // form, and their own upcoming entries. Family/parent keep the children
  // list (with the attendance-status badges read-only).
  const access =
    session.role === "parent" ? ((await familyAccessForAccount(session.accountId)) ?? "parent") : null;

  if (
    (searchParams?.error === "checkin-disabled" || searchParams?.error === "role" || searchParams?.error === "scope") &&
    access === "parent"
  ) {
    return (
      <div>
        <h1 className="title">{t("child.myChildren")}</h1>
        <PickupBanner error={searchParams?.error} t={t} />
        <ChildList accountId={session.accountId} families={families} t={t} />
      </div>
    );
  }

  if (access === "pickup") {
    const today = todayIso();
    const branding = await getBranding();
    const [planned, upcoming] = await Promise.all([
      Promise.all(families.map(async (child: any) => ({ child, row: await getPickupTime(String(child.id), today) }))),
      pickupTimesForAccount(session.accountId, today),
    ]);
    return (
      <div>
        <h1 className="title">{t("pickup.title")}</h1>
        <PickupBanner saved={searchParams?.saved} t={t} />
        {planned.map(({ child, row }: any) => (
          <div className="card mb-4" key={child.id}>
            <div className="row" style={{ alignItems: "center", gap: 12 }}>
              <Avatar src={child.photo_url} name={`${child.first_name} ${child.last_name}`} size={52} color={branding.primaryColor} />
              <div>
                <div style={{ fontWeight: 700, fontSize: 18 }}>
                  {child.first_name} {child.last_name}
                </div>
                {row ? (
                  <div className="small" style={{ color: "#047857", fontWeight: 600 }}>
                    {t("pickup.planned", { time: String(row.pickup_time) })}
                  </div>
                ) : (
                  <div className="muted small">{t("pickup.none")}</div>
                )}
              </div>
            </div>
            <PickupTimeForm
              childId={String(child.id)}
              initialTime={row ? String(row.pickup_time) : ""}
              initialNote={row?.note ? String(row.note) : ""}
              labels={{
                timeLabel: t("pickup.timeLabel"),
                noteLabel: t("pickup.noteLabel"),
                notePlaceholder: t("pickup.notePlaceholder"),
                save: t("pickup.save"),
                update: t("pickup.update"),
                remove: t("pickup.remove"),
                saving: t("common.saving"),
              }}
            />
          </div>
        ))}
        <h2 className="title">{t("pickup.upcoming")}</h2>
        {upcoming.length === 0 ? (
          <p className="muted small">{t("pickup.none")}</p>
        ) : (
          <div className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {upcoming.map((r: any) => (
              <div className="list-item small" key={r.id}>
                <span style={{ fontWeight: 600 }}>
                  {r.first_name} {r.last_name}
                </span>
                <span>
                  {String(r.pickup_date)} · {String(r.pickup_time)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <h1 className="title">{t("child.myChildren")}</h1>
      {searchParams?.saved === "1" && <PickupBanner saved="1" t={t} />}
      <ChildList accountId={session.accountId} families={families} t={t} />
    </div>
  );
}

async function ChildList({
  accountId,
  families,
  t,
}: {
  accountId: string;
  families: any[];
  t: (k: string, v?: Record<string, string | number>) => string;
}) {
  const withStatus = await Promise.all(
    families.map(async (child: any) => {
      const status = await todayStatus(child.id);
      return { child, status };
    })
  );

  return (
    <div className="grid">
      {withStatus.map(({ child, status }: any) => {
        const seen = status.lastEvent?.type === "in";
        return (
          <ChildCard key={child.id} href={`/child/${child.id}`}>
            <div className="status-card">
              <div>
                <div style={{ fontWeight: 700, fontSize: 18 }}>
                  {child.first_name} {child.last_name}
                </div>
                <div className="muted small">{child.room_name ?? t("child.noRoom")}</div>
              </div>
              {status.checkedIn && !status.checkedOut ? (
                <span className="badge badge-green">{t("attendees.checkedIn")}</span>
              ) : status.checkedOut ? (
                <span className="badge badge-gray">{t("attendees.checkedOut")}</span>
              ) : (
                <span className="badge">{t("attendees.notCheckedInYet")}</span>
              )}
            </div>
            {status.lastEvent && (
              <div className="muted small mt-2">
                {seen
                  ? t("attendees.checkedInAt", { time: time(status.checkedIn?.recorded_at) })
                  : t("attendees.checkedOutAt", { time: time(status.checkedOut?.recorded_at) })}
              </div>
            )}
          </ChildCard>
        );
      })}
    </div>
  );
}

function time(iso?: unknown): string {
  if (!iso) return "—";
  return new Date(String(iso)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
