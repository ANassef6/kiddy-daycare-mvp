import Link from "next/link";
import { resolveTenantInstituteId } from "@/lib/tenant";
import { requireSession } from "@/lib/require";
import { checkedInNow, listChildren, listRoomsScoped } from "@/lib/store";
import { addChildAction, inviteParentAction } from "@/lib/actions";
import Avatar from "@/components/Avatar";
import RelationshipSelect from "@/components/RelationshipSelect";
import CreateParentLoginForm from "@/components/CreateParentLoginForm";
import AddChildParentLoginFields from "@/components/AddChildParentLoginFields";
import { recordToolUsage } from "@/lib/tool-usage";
import { i18nForAccount } from "@/lib/i18n-session";
import { signedUrlsForRefs } from "@/lib/storage";
import { tr } from "@/lib/i18n";
import type { Dict } from "@/lib/i18n";

export const dynamic = "force-dynamic";

// KID-2498: each chip maps to one exact status set from listChildren:
//   ""           -> every status except withdrawn (active + on_hold + pending)
//   "active"     -> active only
//   "on_hold"    -> on_hold only
//   "pending"    -> pending only
//   "withdrawn"  -> withdrawn only
//   "all"        -> every status, including withdrawn
const STATUS_OPTIONS = ["", "active", "on_hold", "pending", "withdrawn", "all"] as const;

function statusOptionLabel(value: string, dict: Dict): string {
  switch (value) {
    case "":
      return tr(dict, "childrenAdd.filterNotWithdrawn");
    case "active":
      return tr(dict, "profile.active");
    case "on_hold":
      return tr(dict, "profile.onHold");
    case "pending":
      return tr(dict, "profile.pending");
    case "withdrawn":
      return tr(dict, "profile.withdrawn");
    default:
      return tr(dict, "childrenAdd.filterEveryone");
  }
}

// KID-2400: child card status badges render through the profile.* keys
// (on_hold has no dedicated key spelling in the raw value).
const CHILD_STATUS_KEYS: Record<string, string> = {
  active: "profile.active",
  on_hold: "profile.onHold",
  pending: "profile.pending",
  withdrawn: "profile.withdrawn",
};

function statusTone(status?: string | null): "green" | "gray" | "red" | undefined {
  if (status === "active") return "green";
  if (status === "withdrawn") return "red";
  return undefined;
}

// KID-733: Add-a-child parent-login rejections map to their own message so the
// staff member immediately knows what failed and that nothing was created.
function addChildLoginErrorMessage(error: string | undefined, dict: Dict): string {
  switch (error) {
    case "addChildLoginNoEmail":
      return tr(dict, "children.addChildLoginEmailRequired");
    case "addChildLoginEmail":
      return tr(dict, "children.addChildLoginErrorEmail");
    case "addChildLoginPassword":
      return tr(dict, "children.addChildLoginErrorPassword");
    case "addChildLoginRole":
      return tr(dict, "children.addChildLoginErrorRole");
    default:
      return "";
  }
}

export default async function PortalChildrenPage(
  props: {
    searchParams: Promise<{ error?: string; status?: string; q?: string; invite?: string; email?: string; code?: string; activationUrl?: string; inviteDetail?: string; prefillEmail?: string; parent?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const session = await requireSession();
  const instituteId = await resolveTenantInstituteId();
  const { dict } = await i18nForAccount(session.accountId);
  // KID-2400: localized relationship option labels shared by every
  // RelationshipSelect on this page.
  const relationshipLabels = {
    parent: tr(dict, "profile.relParent"),
    family: tr(dict, "profile.relFamily"),
    pickup: tr(dict, "profile.relPickup"),
    no_access: tr(dict, "profile.relNoAccess"),
  };
  await recordToolUsage({ instituteId: String(instituteId ?? "") || null, accountId: session.accountId, toolKey: "children", source: "portal", metadata: null });
  const statusFilter = searchParams.status ?? "";
  // KID-2482: the child list gets the same child search as the recipients
  // picker. The invite dropdown below still lists every child.
  const searchQuery = String(searchParams.q ?? "").trim();
  const searchLower = searchQuery.toLowerCase();
  // KID-103: children list and room choices are scoped to assigned classrooms.
  // KID-2505: the live "who is checked in now" set comes from the same
  // center-local-day derivation as the attendance board (one query for the
  // whole page, not one per card). KID-2504 keeps that derivation authoritative.
  const [children, rooms, checkedIn] = await Promise.all([
    instituteId ? listChildren(instituteId, { status: statusFilter, accountId: session.accountId }) : Promise.resolve([]),
    instituteId ? listRoomsScoped(instituteId, session.accountId) : Promise.resolve([]),
    instituteId ? checkedInNow(instituteId, session.accountId) : Promise.resolve([]),
  ]);
  const checkedInIds = new Set(checkedIn.map((c) => String(c.id)));
  // KID-2482: filter the visible cards by name without narrowing the invite
  // dropdown below (which must still offer every child).
  const visibleChildren = searchLower
    ? children.filter((c) => `${c.first_name ?? ""} ${c.last_name ?? ""}`.toLowerCase().includes(searchLower))
    : children;
  // KID-1177: photo refs resolve to signed URLs before the render loop.
  const avatarSrcs = await signedUrlsForRefs(children.map((c) => String(c.photo_url ?? "")));
  const guardianError = searchParams.error === "guardian";
  const relationshipError = searchParams.error === "relationship";
  // KID-2482: add/update refused because no classroom was selected.
  const classroomError = searchParams.error === "classroom";
  // KID-733: the Add-a-child parent-login rejections each name what went wrong
  // and that nothing was created (no child, no contact, no account).
  const addChildLoginError = addChildLoginErrorMessage(searchParams.error, dict);
  // KID-111: invite-delivery outcome from inviteParentAction/resendParentInviteAction.
  const inviteStatus = searchParams.invite;
  const inviteEmail = searchParams.email;
  const inviteActivationUrl = searchParams.activationUrl;
  const inviteDetail = searchParams.inviteDetail;
  const inviteCode = searchParams.code;
  // KID-115: prefill the invite form when linked from a child-detail contact
  // with no login and no pending invite yet. Only valid emails are accepted.
  const rawPrefill = String(searchParams.prefillEmail ?? "").trim().toLowerCase();
  const prefillEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawPrefill) && rawPrefill.length <= 200 ? rawPrefill : "";
  // KID-495: outcome of createParentLoginAction (created | exists | invalid-email
  // | relationship | short-password | missing-name). The password never rides
  // the URL — the admin sees it in the form they typed it into.
  // KID-733: parentLoginOutcome adds linked ( guardianship already had an
  // account ) and child-required ( the childless creation refusal ).
  const parentLoginStatus = searchParams.parent;
  const parentLoginCreated = parentLoginStatus === "created";
  const parentLoginLinked = parentLoginStatus === "linked";
  const parentLoginEmail = searchParams.email;

  return (
    <div>
      {parentLoginStatus && (
        <div
          role="status"
          className="card mt-3"
          style={{ borderLeft: `4px solid ${parentLoginCreated || parentLoginLinked ? "#047857" : "#b91c1c"}` }}
        >
          {parentLoginCreated || parentLoginLinked ? (
            <div className="small">
              <p style={{ margin: "0 0 4px" }}>
                <strong>{tr(dict, "children.parentLoginCreated")}</strong>
              </p>
              {parentLoginLinked && (
                <p style={{ margin: "0 0 4px" }} className="muted">
                  {tr(dict, "children.parentLoginLinked")}
                </p>
              )}
              <p style={{ margin: 0 }} className="muted">
                {tr(dict, "children.parentLoginCreatedHint")}
                {parentLoginEmail ? <> — <strong>{parentLoginEmail}</strong></> : null}
              </p>
            </div>
          ) : parentLoginStatus === "child-required" ? (
            <p className="small" style={{ margin: 0 }}>
              {tr(dict, "children.parentLoginChildRequired")}
            </p>
          ) : (
            <p className="small" style={{ margin: 0 }}>
              {tr(dict, "children.parentLoginError")}
              {parentLoginStatus !== "exists" && parentLoginEmail ? <> ({parentLoginEmail})</> : null}
            </p>
          )}
        </div>
      )}
      {inviteStatus === "child-required" && (
        <div role="alert" className="card mt-3" style={{ borderLeft: "4px solid #b91c1c" }}>
          <p className="small" style={{ margin: 0 }}>
            {tr(dict, "children.addChildLoginChildRequiredInvite")}
          </p>
        </div>
      )}
      {inviteStatus && inviteStatus !== "child-required" && (
        <div
          role="status"
          className="card mt-3"
          style={{
            borderLeft: `4px solid ${inviteStatus === "sent" ? "#047857" : inviteStatus === "pending" ? "#b45309" : "#b91c1c"}`,
          }}
        >
          {inviteStatus === "sent" && (
            <p className="small" style={{ margin: 0 }}>
              {tr(dict, "childrenAdd.inviteSentBanner", {
                emailPart: inviteEmail ? tr(dict, "childrenAdd.inviteToPart", { email: inviteEmail }) : "",
              })}
            </p>
          )}
          {inviteStatus === "pending" && (
            <div className="small">
              <p style={{ margin: "0 0 8px" }}>
                {tr(dict, "childrenAdd.inviteSavedNoProvider", {
                  emailPart: inviteEmail ? tr(dict, "childrenAdd.inviteToPart", { email: inviteEmail }) : "",
                })}
              </p>
              {inviteActivationUrl && (
                <p style={{ margin: "0 0 8px", overflowWrap: "anywhere" }}>
                  <a href={inviteActivationUrl}>{inviteActivationUrl}</a>
                </p>
              )}
              {inviteDetail && <p className="muted" style={{ margin: 0 }}>{inviteDetail}</p>}
            </div>
          )}
          {inviteStatus !== "sent" && inviteStatus !== "pending" && (
            <p className="small" style={{ margin: 0 }}>
              {tr(dict, "childrenAdd.inviteNotSent", {
                status: inviteStatus,
                codePart: inviteCode ? ` — code ${inviteCode}` : "",
                detailPart: inviteDetail ? `: ${inviteDetail}` : "",
              })}
            </p>
          )}
        </div>
      )}
      <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
        <h1 className="title" style={{ marginBottom: 0 }}>{tr(dict, "common.children")}</h1>
        <span className="small muted">{tr(dict, "childrenAdd.enrolledCount", { count: visibleChildren.length })}</span>
      </div>

      {classroomError && (
        <div role="alert" className="card mt-3" style={{ borderLeft: "4px solid #b91c1c" }}>
          <p className="small" style={{ margin: 0 }}>{tr(dict, "childrenAdd.classroomRequiredError")}</p>
        </div>
      )}

      <form method="get" action="/portal/children" className="row mt-3" style={{ gap: 8, alignItems: "flex-end" }}>
        <div className="col field" style={{ maxWidth: 360 }}>
          <label className="label" htmlFor="child-search">{tr(dict, "childrenAdd.searchChildrenPlaceholder")}</label>
          <input
            id="child-search"
            className="input"
            type="search"
            name="q"
            defaultValue={searchQuery}
            placeholder={tr(dict, "childrenAdd.searchChildrenPlaceholder")}
          />
        </div>
        {statusFilter && <input type="hidden" name="status" value={statusFilter} />}
        <button className="btn btn-ghost" type="submit">{tr(dict, "common.search")}</button>
      </form>

      <div className="row mt-3" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span className="small muted">{tr(dict, "childrenAdd.statusColon")}</span>
        {STATUS_OPTIONS.map((s) => {
          const active = statusFilter === s;
          return (
            <Link
              key={s}
              href={`/portal/children${s ? `?status=${s}` : ""}`}
              className={`status-chip ${active ? "status-chip-mood" : ""}`}
              style={{ textDecoration: "none" }}
            >
              {statusOptionLabel(s, dict)}
            </Link>
          );
        })}
      </div>

      {visibleChildren.length === 0 ? (
        <p className="muted small mt-4">{tr(dict, "childrenAdd.noChildrenMatch")}</p>
      ) : (
        <div className="grid mt-4">
          {visibleChildren.map((c: any) => (
            <Link
              key={c.id}
              href={`/portal/children/${c.id}`}
              className="card room-card"
              style={{ color: "inherit", textDecoration: "none" }}
            >
              <div className="row" style={{ alignItems: "center", gap: 12, marginBottom: 12 }}>
                <span className="avatar-wrap">
                  <Avatar src={avatarSrcs.get(String(c.photo_url ?? "")) ?? c.photo_url} name={`${c.first_name} ${c.last_name}`} size={48} />
                  {checkedInIds.has(String(c.id)) && (
                    <span
                      className="avatar-checked-dot"
                      role="img"
                      aria-label={tr(dict, "childrenAdd.checkedIn")}
                      title={tr(dict, "childrenAdd.checkedIn")}
                    />
                  )}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ display: "block" }}>{c.first_name} {c.last_name}</strong>
                  {c.room_id ? (
                    <span className="small muted">{c.room_name ?? tr(dict, "child.noRoom")}</span>
                  ) : (
                    <span className="badge badge-red">{tr(dict, "childrenAdd.needsClassroom")}</span>
                  )}
                </div>
              </div>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <span className={`badge ${statusTone(c.status) ? `badge-${statusTone(c.status)}` : ""}`}>
                  {tr(dict, (c.status && CHILD_STATUS_KEYS[String(c.status)]) || "profile.active")}
                </span>
                <span className="small muted">{c.dob ?? "—"}</span>
              </div>
              {c.allergies && <p className="small muted mt-2">{tr(dict, "childrenAdd.allergiesLabel", { allergies: String(c.allergies) })}</p>}
            </Link>
          ))}
        </div>
      )}

      <details className="card mt-5">
        <summary style={{ cursor: "pointer", fontWeight: 700 }}>{tr(dict, "childrenAdd.addChildSummary")}</summary>
        <form className="mt-3" action={addChildAction}>
          <div className="row">
            <div className="col field"><label className="label">{tr(dict, "profile.firstName")}</label><input className="input" name="firstName" required /></div>
            <div className="col field"><label className="label">{tr(dict, "profile.lastName")}</label><input className="input" name="lastName" required /></div>
          </div>
          <div className="row">
            <div className="col field"><label className="label">{tr(dict, "profile.dateOfBirth")}</label><input className="input" name="dob" type="date" /></div>
            <div className="col field">
              <label className="label">{tr(dict, "common.room")} <span style={{ color: "#b91c1c" }}>*</span></label>
              <select className="select" name="roomId" required defaultValue="">
                <option value="" disabled>{tr(dict, "childrenAdd.selectOption")}</option>
                {rooms.map((r) => <option key={r.id} value={String(r.id)}>{String(r.name)}</option>)}
              </select>
              {rooms.length === 0 && <span className="small muted">{tr(dict, "childrenAdd.classroomRequiredHint")}</span>}
            </div>
            <div className="col field"><label className="label">{tr(dict, "common.allergies")}</label><input className="input" name="allergies" /></div>
          </div>

          <h3 className="subtitle mt-4">{tr(dict, "childrenAdd.guardianHeading")} <span style={{ color: "#b91c1c" }}>*</span></h3>
          <p className="small muted">{tr(dict, "childrenAdd.guardianRequiredHint")}</p>
          <div className="row">
            <div className="col field"><label className="label">{tr(dict, "profile.fullName")}</label><input className="input" name="guardianName" required placeholder={tr(dict, "childrenAdd.fullNamePlaceholder")} /></div>
            <div className="col field"><label className="label">{tr(dict, "profile.relationship")}</label><RelationshipSelect name="guardianRelationship" labels={relationshipLabels} /></div>
          </div>
          <div className="row">
            <div className="col field"><label className="label">{tr(dict, "common.phone")}</label><input className="input" name="guardianPhone" /></div>
          </div>
          <AddChildParentLoginFields
            labels={{
              emailLabel: tr(dict, "common.email"),
              passwordLabel: tr(dict, "children.createParentLoginPassword"),
              passwordPlaceholder: tr(dict, "children.changePasswordMinLengthHint"),
              generateBtn: tr(dict, "children.createParentLoginGenerate"),
              emailRequiredHint: tr(dict, "children.addChildLoginEmailRequired"),
            }}
          />
          <details className="mt-2">
            <summary className="small muted" style={{ cursor: "pointer" }}>
              {tr(dict, "children.addChildLoginSection")}
            </summary>
            <p className="small muted mt-2">{tr(dict, "children.addChildLoginHint")}</p>
          </details>
          <label className="row small" style={{ alignItems: "center", gap: 8 }}>
            <input type="checkbox" name="guardianIsPickup" defaultChecked /> {tr(dict, "profile.authorizedPickup")}
          </label>
          <label className="row small mt-2" style={{ alignItems: "center", gap: 8 }}>
            <input type="checkbox" name="guardianIsEmergency" defaultChecked /> {tr(dict, "profile.emergencyContact")}
          </label>
          {guardianError && (
            <p className="small" style={{ color: "#b91c1c", marginTop: 8 }}>
              {tr(dict, "childrenAdd.guardianError")}
            </p>
          )}
          {relationshipError && (
            <p className="small" style={{ color: "#b91c1c", marginTop: 8 }}>
              {tr(dict, "profile.contactRelationshipInvalid")}
            </p>
          )}
          {addChildLoginError && (
            <p className="small" style={{ color: "#b91c1c", marginTop: 8 }}>
              {addChildLoginError}
            </p>
          )}
          <button className="btn btn-primary" type="submit">{tr(dict, "childrenAdd.addChildBtn")}</button>
        </form>
      </details>

      <h2 className="title mt-5" id="invite-parent">{tr(dict, "childrenAdd.inviteParentTitle")}</h2>
      <form className="card" action={inviteParentAction}>
        <div className="row">
          <div className="col field">
            <label className="label">{tr(dict, "common.child")}</label>
            <select className="select" name="childId" required defaultValue="">
              <option value="" disabled>{tr(dict, "children.createParentLoginChildPlaceholder")}</option>
              {children.map((c: any) => <option key={c.id} value={String(c.id)}>{c.first_name} {c.last_name}</option>)}
            </select>
          </div>
          <div className="col field"><label className="label">{tr(dict, "children.createParentLoginEmail")}</label><input className="input" name="email" type="email" required defaultValue={prefillEmail} /></div>
          <div className="col field"><label className="label">{tr(dict, "profile.relationship")}</label><RelationshipSelect name="relationship" labels={relationshipLabels} /></div>
          <div className="col field"><label className="label">{tr(dict, "childrenAdd.inviteCodeLabel")}</label><input className="input" name="code" required placeholder={tr(dict, "childrenAdd.inviteCodePlaceholder")} /></div>
        </div>
        <button className="btn btn-accent" type="submit">{tr(dict, "childrenAdd.sendInviteBtn")}</button>
      </form>

      {/* KID-495: admin-created parent login beside the invite flow — a
          temporary password shared in person instead of an activation email. */}
      <h2 className="title mt-5" id="create-parent-login">{tr(dict, "children.createParentLoginTitle")}</h2>
      <CreateParentLoginForm
        labels={{
          hint: tr(dict, "children.createParentLoginHint"),
          childLabel: tr(dict, "children.createParentLoginChild"),
          childPlaceholder: tr(dict, "children.createParentLoginChildPlaceholder"),
          nameLabel: tr(dict, "children.createParentLoginName"),
          emailLabel: tr(dict, "children.createParentLoginEmail"),
          relationshipLabel: tr(dict, "children.createParentLoginRelationship"),
          passwordLabel: tr(dict, "children.createParentLoginPassword"),
          passwordPlaceholder: tr(dict, "children.changePasswordMinLengthHint"),
          generateBtn: tr(dict, "children.createParentLoginGenerate"),
          submitBtn: tr(dict, "children.createParentLoginSubmit"),
        }}
        kids={children.map((c: any) => ({ id: String(c.id), first_name: String(c.first_name), last_name: String(c.last_name) }))}
        relationship={<RelationshipSelect name="relationship" labels={relationshipLabels} />}
      />
    </div>
  );
}
