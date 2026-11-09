import { redirect } from "next/navigation";
import Link from "next/link";
import { resolveTenantInstituteId } from "@/lib/tenant";
import { requireSession } from "@/lib/require";
import { isAdminRole } from "@/lib/role";
import {getInstitute, getWorkingHours } from "@/lib/store";
import { saveBrandingAction, saveCenterDetailsAction, uploadBrandingImageAction } from "@/lib/actions";
import { brandingFromInstitute } from "@/lib/theme";
import { DEFAULT_CURRENCY, SUPPORTED_CURRENCIES } from "@/lib/currency";
import Avatar from "@/components/Avatar";
import LanguageSettingsCard from "@/components/LanguageSettingsCard";
import { i18nForAccount } from "@/lib/i18n-session";
import { tr } from "@/lib/i18n";
import { WorkingHoursEditor } from "@/components/WorkingHoursEditor";

export const dynamic = "force-dynamic";

export default async function PortalSettingsPage(
  props: {
    // KID-489 item 2 (KID-491): save actions bounce back with ?error=… so the
    // rejection reason can render as a localized banner above the form.
    searchParams?: Promise<{ error?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const session = await requireSession();
  // KID-105 #15: Center details (and the rest of center configuration) is
  // admin-only. Staff landing here are sent back to the dashboard.
  if (!isAdminRole(session.role)) {
    redirect("/portal/dashboard");
  }
  const { locale, dict } = await i18nForAccount(session.accountId);
  const iid = await resolveTenantInstituteId();
  const institute = iid ? await getInstitute(iid) : undefined;
  const week = iid ? await getWorkingHours(iid) : {};
  const b = brandingFromInstitute(institute as any);

  // KID-493: every upload bounces back to this page — surface the reason as a
  // localized banner (storage unconfigured vs failed upload) instead of the
  // previous silent no-op that kept the old branding with no explanation.
  const uploadError =
    searchParams?.error === "upload-storage"
      ? tr(dict, "settings.uploadStorageError")
      : searchParams?.error === "upload-failed"
        ? tr(dict, "settings.uploadFailedError")
        : null;

  return (
    <div>
      <h1 className="title">{tr(dict, "settings.title")}</h1>
      {uploadError && (
        <div role="alert" className="banner-error" style={{ padding: "10px 12px", marginBottom: 16, borderRadius: 8 }} dir="auto">
          <bdi>{uploadError}</bdi>
        </div>
      )}
      <p className="subtitle">
        {tr(dict, "settings.subtitle")}{" "}
        <Link href="/portal/rooms" className="small" style={{ fontWeight: 600, marginLeft: 4 }}>
          {tr(dict, "settings.roomsPage")}
        </Link>
        {tr(dict, "settings.subtitleTail")}
      </p>

      <LanguageSettingsCard locale={locale} dict={dict} />

      <div className="card mb-4" id="working-hours">
        <h3 className="subtitle">{tr(dict, "settings.workingHoursTitle")}</h3>
        <p className="small muted">{tr(dict, "settings.workingHoursHint")}</p>
        <WorkingHoursEditor
          week={week}
          t={{
            day: tr(dict, "settings.day"),
            open: tr(dict, "settings.open"),
            close: tr(dict, "settings.close"),
            closed: tr(dict, "settings.closed"),
            save: tr(dict, "settings.saveWorkingHours"),
            help: tr(dict, "settings.workingHoursHelp"),
            saved: tr(dict, "settings.workingHoursSaved"),
            // KID-221: localized day names (Sunday first, matching DAY_LABELS)
            // + the "today" marker so the table follows the account locale.
            dayLabels: [
              "daySunday", "dayMonday", "dayTuesday", "dayWednesday", "dayThursday", "dayFriday", "daySaturday",
            ].map((k) => tr(dict, `settings.${k}`)),
            today: tr(dict, "settings.today"),
          }}
        />
      </div>

      <form className="card mb-4" action={saveCenterDetailsAction}>
        <h3 className="subtitle">{tr(dict, "settings.centerDetails")}</h3>
        <div className="row">
          <div className="col field"><label className="label">{tr(dict, "settings.centerName")}</label><input className="input" name="name" defaultValue={institute?.name ?? ""} placeholder={tr(dict, "settings.centerNamePlaceholder")} /></div>
          <div className="col field"><label className="label">{tr(dict, "settings.contact")}</label><input className="input" name="contact" defaultValue={String(institute?.contact ?? "")} placeholder={tr(dict, "settings.contactPlaceholder")} /></div>
        </div>
        <div className="row">
          {/* KID-489 item 1 (KID-490): the center's default currency — new
              child invoices and finance display fallbacks follow this. */}
          <div className="col field">
            <label className="label">{tr(dict, "settings.defaultCurrency")}</label>
            <select className="select" name="defaultCurrency" defaultValue={String(institute?.default_currency ?? DEFAULT_CURRENCY)}>
              {SUPPORTED_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
        {/* KID-1329: one center-level toggle for the parent check-in/out
            surface. Default ON; when OFF the parent app hides its control and
            the server action (web + mobile) rejects it, while attendance
            status stays visible. Hidden "0" + checkbox "1" makes a save
            without a check an explicit OFF. */}
        <div className="field">
          <label className="label" htmlFor="allowParentCheckInout">{tr(dict, "settings.allowParentCheckInOut")}</label>
          <input type="hidden" name="allowParentCheckInout" value="0" />
          <div className="row" style={{ alignItems: "center", gap: 10 }}>
            <input
              id="allowParentCheckInout"
              name="allowParentCheckInout"
              type="checkbox"
              value="1"
              style={{ width: 20, height: 20, flex: "none", accentColor: b.primaryColor }}
              defaultChecked={institute?.allow_parent_check_inout === undefined || Number(institute?.allow_parent_check_inout) !== 0}
            />
            <span className="small muted">{tr(dict, "settings.allowParentCheckInOutHint")}</span>
          </div>
        </div>
        <div className="field"><label className="label">{tr(dict, "settings.address")}</label><input className="input" name="address" defaultValue={String(institute?.address ?? "")} placeholder={tr(dict, "settings.addressPlaceholder")} /></div>
        {/* KID-489 item 2 (KID-491): the center's Instapay payment link — the
            default every new child invoice form prefills. http/https URLs
            only; an invalid value is rejected with a banner instead of being
            stored. */}
        <div className="field">
          <label className="label">{tr(dict, "settings.instapayLink")}</label>
          <input className="input" name="instapayUrl" type="url" inputMode="url" defaultValue={String(institute?.instapay_url ?? "")} placeholder={tr(dict, "settings.instapayLinkPlaceholder")} />
          <p className="small muted">{tr(dict, "settings.instapayLinkHint")}</p>
        </div>
        {searchParams?.error === "instapay" && (
          <div role="alert" className="card" style={{ borderLeft: "4px solid #b91c1c" }}>
            <p className="small" style={{ margin: 0 }}>{tr(dict, "settings.instapayLinkInvalid")}</p>
          </div>
        )}
        <div className="mt-3"><button className="btn btn-primary" type="submit">{tr(dict, "settings.saveCenterDetails")}</button></div>
      </form>

      {/* KID-493: the preview lockup stacks — logo above the full name — so it
          matches how the brand renders on the real surfaces. */}
      <div className="card mb-4" style={{ background: `linear-gradient(135deg, ${b.primaryColor}, ${b.accentColor})`, color: "#fff" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center", padding: "10px 8px" }}>
          {b.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={b.logoUrl} alt="" width={48} height={48} style={{ borderRadius: 12, objectFit: "cover", background: "#fff", flex: "none" }} />
          )}
          <div>
            <div style={{ fontWeight: 800, fontSize: 22 }}>{b.name}</div>
            <div className="small">
              {tr(dict, "settings.primary", { color: b.primaryColor })} ·{" "}
              {tr(dict, "settings.accent", { color: b.accentColor })} ·{" "}
              {tr(dict, "settings.font", { font: b.font })}
            </div>
          </div>
        </div>
      </div>

      {/* #1 Logo upload */}
      <div className="card mb-4">
        <h3 className="subtitle">{tr(dict, "settings.logoAndBrandImage")}</h3>
        <p className="small muted">{tr(dict, "settings.logoHint")}</p>
        <div className="row mt-3">
          <div className="col">
            <div className="label">{tr(dict, "settings.logo")}</div>
            <div className="row" style={{ alignItems: "center", gap: 12 }}>
              <Avatar src={b.logoUrl} name={b.name} size={48} color={b.primaryColor} />
              <form action={uploadBrandingImageAction} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="hidden" name="kind" value="logo" />
                <input type="file" name="file" accept="image/*" required style={{ fontSize: 13 }} />
                <button className="btn btn-ghost" type="submit" style={{ fontSize: 13 }}>{tr(dict, "settings.upload")}</button>
              </form>
            </div>
          </div>
          <div className="col">
            <div className="label">{tr(dict, "settings.brandImage")}</div>
            <div className="row" style={{ alignItems: "center", gap: 12 }}>
              {b.brandImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={b.brandImageUrl} alt="" width={48} height={48} style={{ borderRadius: 12, objectFit: "cover" }} />
              ) : (
                <div style={{ width: 48, height: 48, borderRadius: 12, background: "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: "#64748b" }}>—</div>
              )}
              <form action={uploadBrandingImageAction} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="hidden" name="kind" value="brandImage" />
                <input type="file" name="file" accept="image/*" required style={{ fontSize: 13 }} />
                <button className="btn btn-ghost" type="submit" style={{ fontSize: 13 }}>{tr(dict, "settings.upload")}</button>
              </form>
            </div>
          </div>
        </div>
      </div>

      <form className="card" action={saveBrandingAction}>
        <div className="row">
          <div className="col field"><label className="label">{tr(dict, "settings.daycareName")}</label><input className="input" name="name" defaultValue={b.name} /></div>
          <div className="col field"><label className="label">{tr(dict, "settings.primaryColor")}</label><input className="input" name="primaryColor" type="color" defaultValue={b.primaryColor} style={{ height: 44 }} /></div>
          <div className="col field"><label className="label">{tr(dict, "settings.accentColor")}</label><input className="input" name="accentColor" type="color" defaultValue={b.accentColor} style={{ height: 44 }} /></div>
        </div>
        <div className="field"><label className="label">{tr(dict, "settings.fontLabel")}</label>
          <select className="select" name="font" defaultValue={b.font}>
            <option value="Inter">Inter</option>
            <option value="Nunito">Nunito</option>
            <option value="Poppins">Poppins</option>
            <option value="Georgia">Georgia</option>
          </select>
        </div>
        <button className="btn btn-primary" type="submit">{tr(dict, "settings.saveBranding")}</button>
      </form>
    </div>
  );
}