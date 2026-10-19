// KID-199.3r (KID-212): the neutral error page for a hostname under the
// wildcard that no daycare claims. No tenant data, no first-institute
// fallback, no branding — just the platform name and a way back.
import Link from "next/link";
import { SITE_BRAND, SITE_TAGLINE } from "@/lib/site";

export const dynamic = "force-static";

export default function UnknownDaycarePage() {
  return (
    <div className="container" style={{ maxWidth: 480, paddingTop: 100, textAlign: "center" }}>
      <p className="brand" style={{ marginBottom: 24 }}>{SITE_BRAND}</p>
      <h1 className="title">Daycare not found</h1>
      <p className="subtitle" style={{ marginTop: 8 }}>
        This address does not match a daycare on {SITE_BRAND}. {SITE_TAGLINE}.
      </p>
      <p className="small muted" style={{ marginTop: 8 }}>
        Check the address your daycare gave you, or start from the main site.
      </p>
      <p style={{ marginTop: 24 }}>
        <Link className="btn btn-primary" href="/">Go to the main site</Link>
      </p>
    </div>
  );
}
