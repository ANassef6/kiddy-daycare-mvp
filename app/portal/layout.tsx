import Link from "next/link";
import PortalSidebar from "@/components/PortalSidebar";
import { requireSession } from "@/lib/require";
import { getBranding } from "@/lib/theme";

export const dynamic = "force-dynamic";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = requireSession();
  let logoUrl: string | null = null;
  let brandName = "Kiddy";
  try {
    const b = await getBranding();
    logoUrl = b.logoUrl;
    brandName = b.name;
  } catch {}
  return (
    <div className="shell">
      <PortalSidebar brandName={brandName} logoUrl={logoUrl} />
      <main className="shell-main">
        {!session.emailConfirmed && (
          <div
            className="small"
            style={{
              background: "#fef3c7",
              border: "1px solid #f59e0b",
              borderRadius: 8,
              padding: "8px 12px",
              marginBottom: 12,
            }}
          >
            Your email isn&apos;t confirmed yet — password sign-in is locked until you click the link we sent.
            <Link href="/welcome" className="small" style={{ marginLeft: 8, fontWeight: 600 }}>
              Confirm your email
            </Link>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}