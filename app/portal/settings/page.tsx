import { requireSession } from "@/lib/require";
import { listInstitutes, getInstitute } from "@/lib/store";
import { saveBrandingAction, saveCenterDetailsAction, uploadBrandingImageAction } from "@/lib/actions";
import { brandingFromInstitute } from "@/lib/theme";
import Avatar from "@/components/Avatar";
import LanguageSettingsCard from "@/components/LanguageSettingsCard";
import { i18nForAccount } from "@/lib/i18n-session";
import { tr } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function PortalSettingsPage() {
  const session = requireSession();
  const { locale, dict } = await i18nForAccount(session.accountId);
  const institutes = await listInstitutes();
  const iid = institutes[0]?.id as string | undefined;
  const institute = iid ? await getInstitute(iid) : undefined;
  const b = brandingFromInstitute(institute as any);

  return (
    <div>
      <h1 className="title">{tr(dict, "settings.title")}</h1>
      <p className="subtitle">
        {tr(dict, "settings.subtitle")}{" "}
        <a href="/portal/rooms" className="small" style={{ fontWeight: 600, marginLeft: 4 }}>
          {tr(dict, "settings.roomsPage")}
        </a>
        {tr(dict, "settings.subtitleTail")}
      </p>

      <LanguageSettingsCard locale={locale} dict={dict} />

      <form className="card mb-4" action={saveCenterDetailsAction}>
        <h3 className="subtitle">{tr(dict, "settings.centerDetails")}</h3>
        <div className="row">
          <div className="col field"><label className="label">{tr(dict, "settings.centerName")}</label><input className="input" name="name" defaultValue={institute?.name ?? ""} placeholder="e.g. Sunshine Daycare" /></div>
          <div className="col field"><label className="label">{tr(dict, "settings.contact")}</label><input className="input" name="contact" defaultValue={String(institute?.contact ?? "")} placeholder="Phone / email, e.g. +20 100 000 0000" /></div>
        </div>
        <div className="field"><label className="label">{tr(dict, "settings.address")}</label><input className="input" name="address" defaultValue={String(institute?.address ?? "")} placeholder="Street, district, city" /></div>
        <button className="btn btn-primary" type="submit">{tr(dict, "settings.saveCenterDetails")}</button>
      </form>

      <div className="card mb-4" style={{ background: `linear-gradient(135deg, ${b.primaryColor}, ${b.accentColor})`, color: "#fff" }}>
        <div className="row" style={{ alignItems: "center", gap: 12 }}>
          {b.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={b.logoUrl} alt="" width={48} height={48} style={{ borderRadius: 12, objectFit: "cover", background: "#fff" }} />
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