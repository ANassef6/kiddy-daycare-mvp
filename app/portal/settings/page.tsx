import { requireSession } from "@/lib/require";
import { listInstitutes, getInstitute } from "@/lib/store";
import { saveBrandingAction, uploadBrandingImageAction } from "@/lib/actions";
import { brandingFromInstitute } from "@/lib/theme";
import Avatar from "@/components/Avatar";

export const dynamic = "force-dynamic";

export default async function PortalSettingsPage() {
  requireSession();
  const institutes = await listInstitutes();
  const iid = institutes[0]?.id as string | undefined;
  const institute = iid ? await getInstitute(iid) : undefined;
  const b = brandingFromInstitute(institute as any);

  return (
    <div>
      <h1 className="title">Branding (white-label)</h1>
      <p className="subtitle">
        Swap the daycare name, logo, colors, and font here — every surface re-themes from this
        config. No code changes or redeploys required.
      </p>

      <div className="card mb-4" style={{ background: `linear-gradient(135deg, ${b.primaryColor}, ${b.accentColor})`, color: "#fff" }}>
        <div className="row" style={{ alignItems: "center", gap: 12 }}>
          {b.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={b.logoUrl} alt="" width={48} height={48} style={{ borderRadius: 12, objectFit: "cover", background: "#fff" }} />
          )}
          <div>
            <div style={{ fontWeight: 800, fontSize: 22 }}>{b.name}</div>
            <div className="small">Primary: {b.primaryColor} · Accent: {b.accentColor} · Font: {b.font}</div>
          </div>
        </div>
      </div>

      {/* #1 Logo upload */}
      <div className="card mb-4">
        <h3 className="subtitle">Logo &amp; brand image</h3>
        <p className="small muted">Upload a logo (displayed in headers and the login page) and a brand image.</p>
        <div className="row mt-3">
          <div className="col">
            <div className="label">Logo</div>
            <div className="row" style={{ alignItems: "center", gap: 12 }}>
              <Avatar src={b.logoUrl} name={b.name} size={48} color={b.primaryColor} />
              <form action={uploadBrandingImageAction} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="hidden" name="kind" value="logo" />
                <input type="file" name="file" accept="image/*" required style={{ fontSize: 13 }} />
                <button className="btn btn-ghost" type="submit" style={{ fontSize: 13 }}>Upload</button>
              </form>
            </div>
          </div>
          <div className="col">
            <div className="label">Brand image</div>
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
                <button className="btn btn-ghost" type="submit" style={{ fontSize: 13 }}>Upload</button>
              </form>
            </div>
          </div>
        </div>
      </div>

      <form className="card" action={saveBrandingAction}>
        <div className="row">
          <div className="col field"><label className="label">Daycare name</label><input className="input" name="name" defaultValue={b.name} /></div>
          <div className="col field"><label className="label">Primary color</label><input className="input" name="primaryColor" type="color" defaultValue={b.primaryColor} style={{ height: 44 }} /></div>
          <div className="col field"><label className="label">Accent color</label><input className="input" name="accentColor" type="color" defaultValue={b.accentColor} style={{ height: 44 }} /></div>
        </div>
        <div className="field"><label className="label">Font</label>
          <select className="select" name="font" defaultValue={b.font}>
            <option value="Inter">Inter</option>
            <option value="Nunito">Nunito</option>
            <option value="Poppins">Poppins</option>
            <option value="Georgia">Georgia</option>
          </select>
        </div>
        <button className="btn btn-primary" type="submit">Save branding</button>
      </form>
    </div>
  );
}
