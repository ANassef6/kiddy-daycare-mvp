import Link from "next/link";
import { resolveTenantInstituteId } from "@/lib/tenant";
import { requireSession } from "@/lib/require";
import { listChildren, listRoomsScoped } from "@/lib/store";
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

const STATUS_OPTIONS = [
  { value: "", label: "All active" },
  { value: "active", label: "Active" },
  { value: "on_hold", label: "On hold" },
  { value: "pending", label: "Pending" },
  { value: "withdrawn", label: "Withdrawn" },
  { value: "all", label: "All" },
];

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
    searchParams: Promise<{ error?: string; status?: string; invite?: string; email?: string; code?: string; activationUrl?: string; inviteDetail?: string; prefillEmail?: string; parent?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const session = await requireSession();
  const instituteId = await resolveTenantInstituteId();
  const { dict } = await i18nForAccount(session.accountId);
  await recordToolUsage({ instituteId: String(instituteId ?? "") || null, accountId: session.accountId, toolKey: "children", source: "portal", metadata: null });
  const statusFilter = searchParams.status ?? "";
  // KID-103: children list and room choices are scoped to assigned classrooms.
  const [children, rooms] = await Promise.all([
    instituteId ? listChildren(instituteId, { status: statusFilter, accountId: session.accountId }) : Promise.resolve([]),
    instituteId ? listRoomsScoped(instituteId, session.accountId) : Promise.resolve([]),
  ]);
  // KID-1177: photo refs resolve to signed URLs before the render loop.
  const avatarSrcs = await signedUrlsForRefs(children.map((c) => String(c.photo_url ?? "")));
  const guardianError = searchParams.error === "guardian";
  const relationshipError = searchParams.error === "relationship";
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
              Activation email sent{inviteEmail ? <> to <strong>{inviteEmail}</strong></> : null}. It should arrive within 2 minutes (check spam too).
            </p>
          )}
          {inviteStatus === "pending" && (
            <div className="small">
              <p style={{ margin: "0 0 8px" }}>
                Invite saved{inviteEmail ? <> for <strong>{inviteEmail}</strong></> : null}, but no mail provider is configured so no email was sent.
                Forward the activation link manually:
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
              Invite not sent ({inviteStatus}
              {inviteCode ? <> — code <strong>{inviteCode}</strong></> : null}
              {inviteDetail ? <>: {inviteDetail}</> : null}). Fix the details and try again.
            </p>
          )}
        </div>
      )}
      <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
        <h1 className="title" style={{ marginBottom: 0 }}>Children</h1>
        <span className="small muted">{children.length} enrolled</span>
      </div>

      <div className="row mt-3" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span className="small muted">Status:</span>
        {STATUS_OPTIONS.map((s) => {
          const active = statusFilter === s.value;
          return (
            <Link
              key={s.value}
              href={`/portal/children${s.value ? `?status=${s.value}` : ""}`}
              className={`status-chip ${active ? "status-chip-mood" : ""}`}
              style={{ textDecoration: "none" }}
            >
              {s.label}
            </Link>
          );
        })}
      </div>

      {children.length === 0 ? (
        <p className="muted small mt-4">No children match this filter.</p>
      ) : (
        <div className="grid mt-4">
          {children.map((c: any) => (
            <Link
              key={c.id}
              href={`/portal/children/${c.id}`}
              className="card room-card"
              style={{ color: "inherit", textDecoration: "none" }}
            >
              <div className="row" style={{ alignItems: "center", gap: 12, marginBottom: 12 }}>
                <Avatar src={avatarSrcs.get(String(c.photo_url ?? "")) ?? c.photo_url} name={`${c.first_name} ${c.last_name}`} size={48} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ display: "block" }}>{c.first_name} {c.last_name}</strong>
                  <span className="small muted">{c.room_name ?? "No room"}</span>
                </div>
              </div>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <span className={`badge ${statusTone(c.status) ? `badge-${statusTone(c.status)}` : ""}`}>
                  {c.status ? String(c.status).replace("_", " ") : "Active"}
                </span>
                <span className="small muted">{c.dob ?? "—"}</span>
              </div>
              {c.allergies && <p className="small muted mt-2">Allergies: {c.allergies}</p>}
            </Link>
          ))}
        </div>
      )}

      <details className="card mt-5">
        <summary style={{ cursor: "pointer", fontWeight: 700 }}>+ Add a child</summary>
        <form className="mt-3" action={addChildAction}>
          <div className="row">
            <div className="col field"><label className="label">First name</label><input className="input" name="firstName" required /></div>
            <div className="col field"><label className="label">Last name</label><input className="input" name="lastName" required /></div>
          </div>
          <div className="row">
            <div className="col field"><label className="label">Date of birth</label><input className="input" name="dob" type="date" /></div>
            <div className="col field">
              <label className="label">Room</label>
              <select className="select" name="roomId">
                <option value="">— select —</option>
                {rooms.map((r) => <option key={r.id} value={String(r.id)}>{String(r.name)}</option>)}
              </select>
            </div>
            <div className="col field"><label className="label">Allergies</label><input className="input" name="allergies" /></div>
          </div>

          <h3 className="subtitle mt-4">Parent / guardian <span style={{ color: "#b91c1c" }}>*</span></h3>
          <p className="small muted">A child must have at least one parent/guardian attached.</p>
          <div className="row">
            <div className="col field"><label className="label">Full name</label><input className="input" name="guardianName" required placeholder="e.g. Sam Carter" /></div>
            <div className="col field"><label className="label">Relationship</label><RelationshipSelect name="guardianRelationship" /></div>
          </div>
          <div className="row">
            <div className="col field"><label className="label">Phone</label><input className="input" name="guardianPhone" /></div>
          </div>
          <AddChildParentLoginFields
            labels={{
              emailLabel: "Email",
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
            <input type="checkbox" name="guardianIsPickup" defaultChecked /> Authorized pickup
          </label>
          <label className="row small mt-2" style={{ alignItems: "center", gap: 8 }}>
            <input type="checkbox" name="guardianIsEmergency" defaultChecked /> Emergency contact
          </label>
          {guardianError && (
            <p className="small" style={{ color: "#b91c1c", marginTop: 8 }}>
              A parent/guardian (name, relationship, and a phone or email) is required before a child can be added.
            </p>
          )}
          {relationshipError && (
            <p className="small" style={{ color: "#b91c1c", marginTop: 8 }}>
              Relationship must be one of: Parent, Family, Pickup, No access.
            </p>
          )}
          {addChildLoginError && (
            <p className="small" style={{ color: "#b91c1c", marginTop: 8 }}>
              {addChildLoginError}
            </p>
          )}
          <button className="btn btn-primary" type="submit">Add child</button>
        </form>
      </details>

      <h2 className="title mt-5" id="invite-parent">Invite a parent</h2>
      <form className="card" action={inviteParentAction}>
        <div className="row">
          <div className="col field">
            <label className="label">Child</label>
            <select className="select" name="childId" required defaultValue="">
              <option value="" disabled>— select a child —</option>
              {children.map((c: any) => <option key={c.id} value={String(c.id)}>{c.first_name} {c.last_name}</option>)}
            </select>
          </div>
          <div className="col field"><label className="label">Parent email</label><input className="input" name="email" type="email" required defaultValue={prefillEmail} /></div>
          <div className="col field"><label className="label">Relationship</label><RelationshipSelect name="relationship" /></div>
          <div className="col field"><label className="label">Invite code</label><input className="input" name="code" required placeholder="e.g. SUNSHINE-1234" /></div>
        </div>
        <button className="btn btn-accent" type="submit">Send invite</button>
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
        relationship={<RelationshipSelect name="relationship" />}
      />
    </div>
  );
}
