import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/require";
import {
  getChild,
  listContacts,
  listRooms,
  reportFor,
  incidentsForChild,
  todayStatus,
  statusesForChild,
  observationsForChild,
  listChildBilling,
  listMedia,
  listConsents,
  isChildInScope,
} from "@/lib/store";
import {
  saveDailyReportAction,
  updateChildDetailsAction,
  addContactAction,
  createIncidentAction,
  saveChildStatusAction,
  uploadPhotoAction,
  acknowledgeIncidentAction,
} from "@/lib/actions";
import Avatar from "@/components/Avatar";
import ResendActivationButton from "@/components/ResendActivationButton";
import ResendInviteButton from "@/components/ResendInviteButton";
import RelationshipSelect from "@/components/RelationshipSelect";
import MediaDownloadAll from "@/components/MediaDownloadAll";
import { getBranding } from "@/lib/theme";
import { firstInstituteId, fmtDate, cap } from "@/lib/helpers";
import ChildProfileTabs from "@/components/ChildProfileTabs";
import { curriculumTree, ensureCurriculumSeeded } from "@/lib/curriculum";
import ObservationModalTrigger from "@/components/ObservationModalTrigger";
import { queryGet } from "@/lib/db";
import { CONTACT_RELATIONSHIP_LABELS } from "@/lib/contact-relationship";
import { i18nForAccount } from "@/lib/i18n-session";
import { tr } from "@/lib/i18n";

export const dynamic = "force-dynamic";

const MOODS = ["happy", "okay", "fussy", "tired"] as const;
const DIAPERS = ["wet", "soiled", "dry"] as const;
const SLEEP_VALUES = ["fellAsleep", "wokeUp"] as const;
const SICK_VALUES = ["yes", "no"] as const;

export default async function PortalChildPage({ params }: { params: { id: string } }) {
  const session = requireSession();
  const { locale, dict } = await i18nForAccount(session.accountId);
  const t = (key: string, vars?: Record<string, string | number>) => tr(dict, key, vars);
  const child = await getChild(params.id);
  if (!child) notFound();
  // KID-103: direct URLs to out-of-scope children are hidden.
  const iid = await firstInstituteId();
  if (iid && !(await isChildInScope(iid, session.accountId, String(child.id)))) {
    notFound();
  }

  const today = new Date().toISOString().slice(0, 10);
  const [report, contacts, incidents, status, todayStatuses, observations, billing, media, consents, rooms] =
    await Promise.all([
      reportFor(child.id, today),
      listContacts(child.id),
      incidentsForChild(child.id),
      todayStatus(child.id),
      statusesForChild(child.id, today),
      observationsForChild(child.id),
      listChildBilling(child.id),
      iid ? listMedia(iid, child.id) : Promise.resolve([]),
      iid ? listConsents(iid) : Promise.resolve([]),
      iid ? listRooms(iid) : Promise.resolve([]),
    ]);
  const meal = safeJson(report?.meal);
  const branding = await getBranding();
  // KID-113: batched unactivated-state lookup for every contact email (one
  // query, no N+1) so the family tab can show "Resend activation" next to
  // the role for pending accounts only.
  // KID-115: batched pending-invite lookup (one query) so contacts with no
  // login account yet still get a "Resend invite" affordance — the GoTrue
  // button above correctly stays hidden for them, which left admins with no
  // resend path on this page at all.
  const { activationByEmails } = await import("@/lib/activation");
  const { pendingInviteByEmails } = await import("@/lib/invite-email");
  const [activation, pendingInvites] = await Promise.all([
    activationByEmails((contacts as any[]).map((c: any) => c.email)),
    pendingInviteByEmails((contacts as any[]).map((c: any) => c.email)),
  ]);
  try {
    await ensureCurriculumSeeded();
  } catch {}
  let areas: any[] = [];
  try {
    areas = await curriculumTree();
  } catch {
    areas = [];
  }

  const me = await queryGet("SELECT full_name, email FROM account WHERE id = ?", session.accountId);
  const byName = String(me?.full_name ?? me?.email ?? session.accountId);

  const tabs = [
    {
      id: "daily",
      label: t("profile.todaysDailyReport"),
      node: dailyReportTab(child, report, today, todayStatuses, dict),
    },
    {
      id: "about",
      label: t("profile.about", { name: child.first_name }),
      node: aboutTab(child, status, rooms, dict),
    },
    {
      id: "family",
      label: t("profile.pickupAndFamilyContacts"),
      node: contactsTab(child, contacts, dict, activation, pendingInvites),
    },
    {
      id: "media",
      label: t("profile.media", { count: media.length }),
      node: mediaTab(media, dict),
    },
    {
      id: "documents",
      label: t("profile.signedDocuments"),
      node: documentsTab(consents, dict),
    },
    {
      id: "schedules",
      label: `${t("profile.schedules")} (${t("profile.beta")})`,
      node: schedulesTab(child, dict),
    },
    {
      id: "invoices",
      label: t("profile.invoices"),
      node: invoicesTab(child, billing, dict),
    },
    {
      id: "learning",
      label: t("profile.learningHistory"),
      node: learningTab(child, areas, observations, byName, dict, locale),
    },
    {
      id: "incident",
      label: t("profile.incidentsAndAccidents"),
      node: incidentsTab(child, incidents, dict),
    },
  ];

  return (
    <div>
      <Link className="small muted" href="/portal/children">← {t("profile.backToChildren")}</Link>
      <div className="row" style={{ alignItems: "center", gap: 14, marginTop: 8 }}>
        <Avatar src={child.photo_url} name={`${child.first_name} ${child.last_name}`} size={56} color={branding.primaryColor} />
        <div style={{ flex: 1 }}>
          <h1 className="title mt-1" style={{ marginBottom: 0 }}>{child.first_name} {child.last_name}</h1>
          <p className="subtitle" style={{ marginBottom: 0 }}>
            {t("profile.room", { room: child.room_name ?? "—" })} · {child.dob ? t("profile.dob", { date: fmtDate(child.dob) }) : ""}{child.gender ? ` · ${cap(child.gender)}` : ""} · {t("profile.today")}{" "}
            {status.lastEvent ? cap(status.lastEvent.type) : t("profile.notReportedYet")}
          </p>
        </div>
        <form action={uploadPhotoAction} style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="hidden" name="entityType" value="child" />
          <input type="hidden" name="entityId" value={child.id as string} />
          <input type="file" name="file" accept="image/*" required id={`photo-${child.id}`} style={{ display: "none" }} />
          <label htmlFor={`photo-${child.id}`} className="btn btn-ghost" style={{ cursor: "pointer", fontSize: 13 }}>{child.photo_url ? t("profile.changePhoto") : t("profile.addPhoto")}</label>
          <button className="btn btn-primary" type="submit" style={{ fontSize: 13 }}>{t("profile.save")}</button>
        </form>
        <Link href={`/portal/children/${child.id}/development`} className="btn btn-ghost" style={{ fontSize: 13 }}>{t("profile.development")}</Link>
      </div>
      <div style={{ marginTop: 18 }}>
        <ChildProfileTabs tabs={tabs} />
      </div>
    </div>
  );
}

function dailyReportTab(child: any, report: any, today: string, todayStatuses: any[], dict: any) {
  const meal = safeJson(report?.meal);
  const t = (key: string, vars?: Record<string, string | number>) => tr(dict, key, vars);
  return (
    <div>
      <div className="card mb-4">
        <h3 className="subtitle">{t("profile.todaysDailyReport")}</h3>
        {report?.saved_by_name && (
          <p className="small muted" style={{ marginTop: -4 }}>
            {t("profile.lastSavedBy")} <strong>{report.saved_by_name}</strong>
            {report?.created_at ? ` · ${fmtDate(report.created_at)} ${time(report.created_at)}` : ""}
          </p>
        )}
        <form action={saveDailyReportAction}>
          <input type="hidden" name="childId" value={child.id as string} />
          <input type="hidden" name="reportDate" value={today} />
          <div className="field">
            <label className="label">{t("profile.summary")}</label>
            <textarea className="textarea" name="summary" defaultValue={String(report?.summary ?? "")} />
          </div>
          <div className="row">
            <div className="col field"><label className="label">{t("profile.mood")}</label>
              <select className="select" name="mood" defaultValue={String(report?.mood ?? "")}>
                <option value="">—</option>
                {MOODS.map((m) => <option key={m}>{mo(t, m)}</option>)}
              </select>
            </div>
            <div className="col field"><label className="label">{t("profile.sleep")}</label><input className="input" name="sleep" defaultValue={String(report?.sleep ?? "")} placeholder="12:30-14:00" /></div>
            <div className="col field"><label className="label">{t("profile.diaper")}</label><input className="input" name="diaper" defaultValue={String(report?.diaper ?? "")} /></div>
          </div>
          <div className="row">
            <div className="col field"><label className="label">{t("child.breakfast")}</label><input className="input" name="breakfast" defaultValue={String(meal?.breakfast ?? "")} /></div>
            <div className="col field"><label className="label">{t("child.lunch")}</label><input className="input" name="lunch" defaultValue={String(meal?.lunch ?? "")} /></div>
            <div className="col field"><label className="label">{t("child.snack")}</label><input className="input" name="snack" defaultValue={String(meal?.snack ?? "")} /></div>
          </div>
          <div className="field"><label className="label">{t("profile.observation")}</label><textarea className="textarea" name="observation" defaultValue={String(report?.observation ?? "")} /></div>
          <div className="field"><label className="label">{t("profile.note")}</label><input className="input" name="note" defaultValue={String(report?.note ?? "")} /></div>
          <label className="row" style={{ alignItems: "center", gap: 8 }}>
            <input type="checkbox" name="sick" defaultChecked={!!report?.sick} /> <span>{t("profile.markAsSick")}</span>
          </label>
          <div className="mt-3"><button className="btn btn-primary" type="submit">{t("profile.saveReport")}</button></div>
        </form>
      </div>

      <div className="card mb-4">
        <h3 className="subtitle">{t("profile.statusLog")}</h3>
        <p className="small muted">{t("profile.loggedInstantly")}</p>
        <div className="row mt-2">
          <div className="col">
            <div className="label">{t("profile.mood")}</div>
            <div className="row" style={{ gap: 6 }}>
              {MOODS.map((value) => (
                <form key={value} action={saveChildStatusAction}>
                  <input type="hidden" name="childId" value={child.id as string} />
                  <input type="hidden" name="kind" value="mood" />
                  <input type="hidden" name="value" value={value} />
                  <button className="status-chip status-chip-mood" type="submit">{mo(t, value)}</button>
                </form>
              ))}
            </div>
          </div>
          <div className="col">
            <div className="label">{t("profile.diaper")}</div>
            <div className="row" style={{ gap: 6 }}>
              {DIAPERS.map((value) => (
                <form key={value} action={saveChildStatusAction}>
                  <input type="hidden" name="childId" value={child.id as string} />
                  <input type="hidden" name="kind" value="diaper" />
                  <input type="hidden" name="value" value={value} />
                  <button className="status-chip status-chip-diaper" type="submit">{di(t, value)}</button>
                </form>
              ))}
            </div>
          </div>
          <div className="col">
            <div className="label">{t("profile.sleep")}</div>
            <div className="row" style={{ gap: 6 }}>
              {SLEEP_VALUES.map((value) => (
                <form key={value} action={saveChildStatusAction}>
                  <input type="hidden" name="childId" value={child.id as string} />
                  <input type="hidden" name="kind" value="sleep" />
                  <input type="hidden" name="value" value={t(`profile.${value}`)} />
                  <button className="status-chip status-chip-sleep" type="submit">{t(`profile.${value}`)}</button>
                </form>
              ))}
            </div>
          </div>
          <div className="col">
            <div className="label">{t("profile.sick")}</div>
            <div className="row" style={{ gap: 6 }}>
              {SICK_VALUES.map((value) => (
                <form key={value} action={saveChildStatusAction}>
                  <input type="hidden" name="childId" value={child.id as string} />
                  <input type="hidden" name="kind" value="sick" />
                  <input type="hidden" name="value" value={value} />
                  <button className="status-chip status-chip-sick" type="submit">{value === "yes" ? t("child.feelingSick") : t("child.allGood")}</button>
                </form>
              ))}
            </div>
          </div>
        </div>

        <form action={saveChildStatusAction} className="row mt-3" style={{ alignItems: "flex-end" }}>
          <input type="hidden" name="childId" value={child.id as string} />
          <div className="col field">
            <label className="label">{t("profile.customEntry")}</label>
            <div className="row">
              <select className="select" name="kind" defaultValue="mood" style={{ maxWidth: 130 }}>
                <option value="mood">{t("profile.mood")}</option>
                <option value="diaper">{t("profile.diaper")}</option>
                <option value="sleep">{t("profile.sleep")}</option>
                <option value="sick">{t("profile.sick")}</option>
              </select>
              <input className="input" name="value" required placeholder="e.g. 'Rash on arm' or '12:45-13:30'" />
            </div>
          </div>
          <div className="col field"><label className="label">{t("profile.note")}</label><input className="input" name="note" placeholder={t("profile.optional")} /></div>
          <div><button className="btn btn-ghost" type="submit">{t("profile.logStatus")}</button></div>
        </form>

        {todayStatuses.length === 0 ? (
          <p className="muted small mt-3">{t("profile.noStatusYet")}</p>
        ) : (
          <div className="mt-3" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {todayStatuses.map((s: any) => (
              <div className="list-item small" key={s.id}>
                <span className={`status-chip status-chip-${String(s.kind)}`}>{kindName(String(s.kind), t)}</span>
                <div>
                  <strong>{displayValue(String(s.kind), String(s.value), t)}</strong>
                  {s.note ? <span className="muted"> — {s.note}</span> : null}
                </div>
                <span className="muted">{time(s.recorded_at)}{s.recorded_by_name ? ` · ${s.recorded_by_name}` : ""}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function aboutTab(child: any, status: any, rooms: any[], dict: any) {
  const t = (key: string, vars?: Record<string, string | number>) => tr(dict, key, vars);
  const rows: [string, string][] = [
    [t("profile.fullName"), `${child.first_name} ${child.last_name}`],
    [t("profile.dateOfBirth"), child.dob ? fmtDate(child.dob) : "—"],
    [t("profile.gender"), child.gender ? cap(child.gender) : "—"],
    [t("common.room"), child.room_name ?? "—"],
    [t("profile.enrolled"), child.enrolled_at ? fmtDate(child.enrolled_at) : "—"],
    [t("profile.status"), child.status ? cap(String(child.status).replace("_", " ")) : t("profile.active")],
    [t("profile.lastDate"), child.last_date ? fmtDate(child.last_date) : "—"],
    [t("profile.checkInToday"), status.lastEvent ? cap(status.lastEvent.type) : t("profile.notYet")],
  ];
  return (
    <div className="grid">
      <div className="card">
        <h3 className="subtitle">{t("profile.about", { name: child.first_name })}</h3>
        <table className="table">
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}>
                <td className="muted" style={{ width: 180 }}>{k}</td>
                <td><strong>{v}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
        <Link className="btn btn-ghost small mt-3" href={`/portal/children/${child.id}/development`}>{t("profile.learningHistory")} →</Link>
      </div>
      <div className="card">
        <h3 className="subtitle">{t("profile.editDetails")}</h3>
        <form action={updateChildDetailsAction}>
          <input type="hidden" name="childId" value={child.id as string} />
          <div className="row">
            <div className="col field"><label className="label">{t("profile.firstName")}</label><input className="input" name="firstName" defaultValue={String(child.first_name ?? "")} required /></div>
            <div className="col field"><label className="label">{t("profile.lastName")}</label><input className="input" name="lastName" defaultValue={String(child.last_name ?? "")} required /></div>
          </div>
          <div className="row">
            <div className="col field"><label className="label">{t("profile.dateOfBirth")}</label><input className="input" name="dob" type="date" defaultValue={child.dob ? String(child.dob).slice(0, 10) : ""} /></div>
            <div className="col field"><label className="label">{t("profile.gender")}</label>
              <select className="select" name="gender" defaultValue={String(child.gender ?? "")}>
                <option value="">—</option>
                <option value="male">{t("profile.male")}</option>
                <option value="female">{t("profile.female")}</option>
              </select>
            </div>
          </div>
          <div className="field"><label className="label">{t("common.room")}</label>
            <select className="select" name="roomId" defaultValue={String(child.room_id ?? "")}>
              <option value="">—</option>
              {(rooms as any[]).map((r: any) => (
                <option key={r.id} value={String(r.id)}>{r.name}</option>
              ))}
            </select>
          </div>
          <div className="row">
            <div className="col field">
              <label className="label">{t("profile.status")}</label>
              <select className="select" name="status" defaultValue={String(child.status ?? "active")}>
                <option value="active">{t("profile.active")}</option>
                <option value="on_hold">{t("profile.onHold")}</option>
                <option value="pending">{t("profile.pending")}</option>
                <option value="withdrawn">{t("profile.withdrawn")}</option>
              </select>
            </div>
            <div className="col field">
              <label className="label">{t("profile.lastDate")}</label>
              <input className="input" name="lastDate" type="date" defaultValue={child.last_date ? String(child.last_date).slice(0, 10) : ""} />
            </div>
          </div>
          <p className="small muted">{t("profile.lastDateHint")}</p>
          <button className="btn btn-primary" type="submit">{t("profile.saveChanges")}</button>
        </form>
      </div>
    </div>
  );
}

function contactsTab(child: any, contacts: any[], dict: any, activation?: Map<string, { email: string; unactivated: boolean }>, pendingInvites?: Map<string, any>) {
  const t = (key: string, vars?: Record<string, string | number>) => tr(dict, key, vars);
  return (
    <div className="grid">
      <div className="card">
        <h3 className="subtitle">{t("profile.pickupAndFamilyContacts")}</h3>
        {contacts.length === 0 ? <p className="muted small">{t("profile.noneContact")}</p> : null}
        {contacts.map((c: any) => {
          const inviteId = showResendForContact(c, activation)
            ? null
            : pendingInviteIdForContact(c, pendingInvites);
          return (
          <div className="list-item" key={c.id}>
            <div className="small"><strong>{c.full_name}</strong> ({contactRoleLabel(c.relationship)})<br /><span className="muted">{c.phone}</span>{c.email ? <><br /><span className="muted">{c.email}</span></> : null}{showResendForContact(c, activation) ? <><br /><ResendActivationButton email={String(c.email)} /></> : inviteId ? <><br /><ResendInviteButton inviteId={inviteId} /></> : null}</div>
            <div>{c.is_pickup && <span className="badge">{t("child.pickup")}</span>}{c.is_emergency && <span className="badge badge-red">{t("child.emergency")}</span>}</div>
          </div>
          );
        })}
      </div>
      <div className="card">
        <h3 className="subtitle">{t("profile.addContact")}</h3>
        <form action={addContactAction}>
          <input type="hidden" name="childId" value={child.id as string} />
          <div className="field"><label className="label">{t("profile.fullName")}</label><input className="input" name="fullName" required /></div>
          <div className="field"><label className="label">{t("profile.relationship")}</label><RelationshipSelect name="relationship" /></div>
          <div className="field"><label className="label">{t("common.phone")}</label><input className="input" name="phone" /></div>
          <div className="field"><label className="label">{t("common.email")}</label><input className="input" name="email" /></div>
          <label className="row small" style={{ alignItems: "center", gap: 8 }}><input type="checkbox" name="isPickup" /> {t("profile.authorizedPickup")}</label>
          <label className="row small mt-2" style={{ alignItems: "center", gap: 8 }}><input type="checkbox" name="isEmergency" /> {t("profile.emergencyContact")}</label>
          <div className="mt-3"><button className="btn btn-ghost" type="submit">{t("profile.addContactBtn")}</button></div>
        </form>
      </div>
    </div>
  );
}

function mediaTab(media: any[], dict: any) {
  const t = (key: string, vars?: Record<string, string | number>) => tr(dict, key, vars);
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h3 className="subtitle">{t("profile.media", { count: media.length })}</h3>
        <MediaDownloadAll files={(media as any[]).map((m: any) => ({ url: String(m.url), caption: String(m.caption ?? "") }))} />
      </div>
      {media.length === 0 ? <p className="muted small">{t("profile.noMedia")}</p> : null}
      <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
        {media.map((m: any) => (
          <a key={m.id} href={m.url} target="_blank" rel="noreferrer" style={{ display: "block", width: 120, height: 120, borderRadius: 10, overflow: "hidden", border: "1px solid var(--color-border)" }}>
            <img src={m.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </a>
        ))}
      </div>
    </div>
  );
}

function documentsTab(consents: any[], dict: any) {
  const t = (key: string, vars?: Record<string, string | number>) => tr(dict, key, vars);
  return (
    <div className="card">
      <h3 className="subtitle">{t("profile.signedDocuments")}</h3>
      {consents.length === 0 ? <p className="muted small">{t("profile.noDocuments")}</p> : null}
      {consents.map((c: any) => (
        <div className="list-item small" key={c.id}>
          <div><strong>{c.title}</strong><br /><span className="muted">{fmtDate(c.created_at)} — {c.description ?? ""}</span></div>
          <span className="badge badge-green">{c.consentee_name ? t("profile.signed", { name: c.consentee_name }) : cap(c.status ?? "open")}</span>
        </div>
      ))}
    </div>
  );
}

function schedulesTab(child: any, dict: any) {
  const t = (key: string, vars?: Record<string, string | number>) => tr(dict, key, vars);
  return (
    <div className="card">
      <h3 className="subtitle">{t("profile.schedules")} <span className="badge badge-gray">{t("profile.beta")}</span></h3>
      <p className="muted small">{t("profile.scheduleHint", { name: child.first_name })}</p>
    </div>
  );
}

function invoicesTab(child: any, billing: any[], dict: any) {
  const t = (key: string, vars?: Record<string, string | number>) => tr(dict, key, vars);
  const totals = billing.reduce((acc: any, b: any) => acc + Number(b.amount ?? 0), 0);
  const overdue = billing.filter((b: any) => b.status === "overdue").length;
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h3 className="subtitle">{t("profile.invoices")}</h3>
        <Link href={`/portal/children/${child.id}/billing`} className="btn btn-accent small">{t("profile.manageBilling")}</Link>
      </div>
      <p className="small">
        {t("profile.invoiceSummary", { count: billing.length, total: `AED ${totals.toFixed(2)}`, overdue })}
      </p>
      {billing.length === 0 ? <p className="muted small">{t("profile.noInvoices")}</p> : null}
      {billing.map((b: any) => (
        <div className="list-item small" key={b.id}>
          <div><strong>{b.period ?? t("profile.invoice")}</strong><br /><span className="muted">{b.reference ?? b.id}</span></div>
          <div style={{ textAlign: "right" }}>
            <strong>AED {Number(b.amount ?? 0).toFixed(2)}</strong><br />
            <span className={`badge ${b.status === "paid" || b.status === "approved" ? "badge-green" : b.status === "overdue" ? "badge-red" : "badge-gray"}`}>{cap(b.status ?? "draft")}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function learningTab(child: any, areas: any[], observations: any[], byName: string, dict: any, locale: string) {
  const t = (key: string, vars?: Record<string, string | number>) => tr(dict, key, vars);
  return (
    <div className="grid">
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h3 className="subtitle">{t("profile.learningHistory")}</h3>
          <Link className="btn btn-ghost small" href={`/portal/children/${child.id}/development`}>{t("profile.fullDevelopment")}</Link>
        </div>
        {observations.length === 0 ? <p className="muted small">{t("profile.noObservationsYet")}</p> : null}
        {observations.slice(0, 6).map((o: any) => (
          <div className="list-item small" key={o.id}>
            <div>
              <span className="badge">{cap(o.kind)}</span>{" "}
              <strong>{o.title ?? t("learning.observation")}</strong>
              <span className="muted"> · {fmtDate(o.recorded_at ?? o.created_at)}</span>
              {o.milestone_name && <div className="mt-1"><span className="badge badge-green">{o.milestone_name}</span></div>}
              {o.body ? <div className="muted mt-1">{o.body}</div> : null}
            </div>
          </div>
        ))}
      </div>
      <div className="card">
        <h3 className="subtitle">{t("profile.logObservation")}</h3>
        <p className="small muted">{t("profile.learningHint")}</p>
        <ObservationModalTrigger
          children={[child]}
          areas={areas}
          byName={byName}
          defaultChildId={String(child.id)}
          locale={locale as any}
          dict={dict}
        />
      </div>
    </div>
  );
}

function incidentsTab(child: any, incidents: any[], dict: any) {
  const t = (key: string, vars?: Record<string, string | number>) => tr(dict, key, vars);
  return (
    <div className="grid">
      <div className="card">
        <h3 className="subtitle">{t("profile.incidentsAndAccidents")}</h3>
        {incidents.length === 0 ? <p className="muted small">{t("profile.noneIncident")}</p> : null}
        {incidents.map((i: any) => (
          <div className="list-item small" key={i.id}>
            <div><strong>{cap(i.type)}</strong> — {new Date(i.created_at).toDateString()}<br /><span className="muted">{i.description}</span></div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
              <span className={i.acknowledged ? "badge badge-green" : "badge badge-red"}>{i.acknowledged ? t("profile.acked") : t("profile.open")}</span>
              {!i.acknowledged && (
                <form action={acknowledgeIncidentAction}>
                  <input type="hidden" name="id" value={String(i.id)} />
                  <input type="hidden" name="portal" value="1" />
                  <button className="btn btn-ghost small" type="submit">{t("profile.acknowledge")}</button>
                </form>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="card">
        <h3 className="subtitle">{t("profile.logIncidentTitle")}</h3>
        <form action={createIncidentAction}>
          <input type="hidden" name="childId" value={child.id as string} />
          <div className="field"><label className="label">{t("profile.type")}</label>
            <select className="select" name="type"><option value="incident">{t("profile.incident")}</option><option value="accident">{t("profile.accident")}</option></select>
          </div>
          <div className="field"><label className="label">{t("common.description")}</label><textarea className="textarea" name="description" required /></div>
          <button className="btn btn-danger" type="submit">{t("profile.logIncidentBtn")}</button>
        </form>
      </div>
    </div>
  );
}

function safeJson(v: unknown): Record<string, string> {
  if (!v) return {};
  try { return JSON.parse(String(v)); } catch { return {}; }
}

// KID-113: canonical role label when the relationship is one of the 4 enum
// values (KID-112); legacy free text renders as-is until migrated.
function contactRoleLabel(relationship: unknown): string {
  const raw = String(relationship ?? "");
  const key = raw.trim().toLowerCase();
  const labels = CONTACT_RELATIONSHIP_LABELS as Record<string, string>;
  return labels[key] ?? (raw || "—");
}

// KID-113: resend affordance only for contacts whose login account exists
// and is still unconfirmed. Contacts without an account (no login yet) and
// activated accounts show nothing.
function showResendForContact(
  contact: any,
  activation?: Map<string, { email: string; unactivated: boolean }>
): boolean {
  const email = String(contact?.email ?? "").trim().toLowerCase();
  if (!email || !activation) return false;
  return activation.get(email)?.unactivated === true;
}

// KID-115: invite-resend affordance for contacts with a pending invite but no
// unactivated login account (the GoTrue button above correctly stays hidden
// for them). Returns the pending invite id, or null when there is nothing to
// resend (no email, or no pending invite — admin uses "Invite a parent").
function pendingInviteIdForContact(
  contact: any,
  pendingInvites?: Map<string, any>
): string | null {
  const email = String(contact?.email ?? "").trim().toLowerCase();
  if (!email || !pendingInvites) return null;
  const invite = pendingInvites.get(email);
  return invite ? String(invite.id) : null;
}
function capital(s: unknown) { const v = String(s ?? ""); return v.charAt(0).toUpperCase() + v.slice(1); }
function time(v?: unknown): string {
  if (!v) return "—";
  return new Date(String(v)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function displayValue(kind: string, value: string, t: any): string {
  if (kind === "sick" && value === "yes") return t("child.feelingSick");
  if (kind === "sick" && value === "no") return t("child.allGood");
  if (kind === "mood") return mo(t, value as any);
  if (kind === "diaper") return di(t, value as any);
  if (kind === "sleep") return value === "Fell asleep" || value === "Woke up" ? value : cap(value);
  return cap(value);
}
function mo(t: any, value: string): string {
  if (value === "happy" || value === "okay" || value === "fussy" || value === "tired") return t(`profile.${value}`);
  return cap(value);
}
function di(t: any, value: string): string {
  if (value === "wet") return t("profile.wet");
  if (value === "soiled") return t("profile.soiled");
  if (value === "dry") return t("profile.dryCheck");
  return cap(value);
}
function kindName(kind: string, t: any): string {
  if (kind === "mood") return t("child.mood");
  if (kind === "sleep") return t("child.sleep");
  if (kind === "diaper") return t("child.diaper");
  if (kind === "sick") return t("child.sickToday");
  return cap(kind);
}