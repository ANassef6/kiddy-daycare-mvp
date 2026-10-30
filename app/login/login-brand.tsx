"use client";

import { useEffect, useState } from "react";

// KID-368 (DEF-004): the brand header on /login keeps its client-side
// /api/branding fetch (the white-label daycares' own name/logo — proper
// nouns, not translated), while every static label moves to the localized
// server page that mounts this component.
export default function LoginBrand({ brandName }: { brandName: string }) {
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
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
      {brand?.logoUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={brand.logoUrl} alt="" width={40} height={40} style={{ borderRadius: 10, objectFit: "cover" }} />
      )}
      <span className="brand">{brand?.name || brandName}</span>
    </div>
  );
}
