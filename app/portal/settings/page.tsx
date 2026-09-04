import { requireSession } from "@/lib/require";
import { listInstitutes, getInstitute } from "@/lib/store";
import { saveBrandingAction } from "@/lib/actions";
import { brandingFromInstitute } from "@/lib/theme";

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
        Swap the daycare name, colors, and font here — every surface re-themes from this
        config. No code changes or redeploys required.
      </p>

      <div className="card mb-4" style={{ background: `linear-gradient(135deg, ${b.primaryColor}, ${b.accentColor})`, color: "#fff" }}>
        <div style={{ fontWeight: 800, fontSize: 22 }}>{b.name}</div>
        <div className="small">Primary: {b.primaryColor} · Accent: {b.accentColor} · Font: {b.font}</div>
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
