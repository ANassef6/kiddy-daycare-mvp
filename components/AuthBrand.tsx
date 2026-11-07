"use client";

import { useEffect, useState } from "react";

// KID-437: the auth surfaces (/login, /register, /forgot-password) share one
// brand header. KID-368 (DEF-004) introduced the client-side /api/branding
// fetch for /login (the white-label daycares' own name/logo — proper nouns,
// not translated); KID-437 extends the same per-origin rule to the other two
// auth pages, whose header previously stayed a hardcoded generic-Kiddy span
// on a tenant's own subdomain. The server page resolves the first paint
// string itself (the same per-origin rule as the KID-435 titles — a known
// daycare subdomain names that tenant, a signed-in account names its own
// daycare, everything else stays generic Kiddy) and passes it down as the
// fallback, so SSR and pre-hydration paints already carry the tenant brand;
// the client fetch then keeps the header live against /api/branding updates.
export default function AuthBrand({ brandName }: { brandName: string }) {
  const [brand, setBrand] = useState<{ name: string; logoUrl: string | null; primaryColor: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/branding")
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setBrand(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    // KID-493: the auth lockup stacks — logo above the full daycare name —
    // with the same wrapping rule as the app surfaces so long white-label
    // names stay readable on narrow phones.
    <div
      className="site-brand"
      style={{ width: "100%", marginBottom: 16 }}
    >
      {brand?.logoUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={brand.logoUrl} alt="" width={40} height={40} className="site-logo" />
      )}
      <span className="brand">{brand?.name || brandName}</span>
    </div>
  );
}
