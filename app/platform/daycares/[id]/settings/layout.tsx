// KID-2477: the per-daycare Settings section chrome. The old Billing section
// becomes Settings, with Billing, Invoices and the read-only Center
// configuration as sub-pages. Every entry is a real href so it stays
// middle-clickable and works without client JS.
import { requireSession } from "@/lib/require";
import { i18nForAccount } from "@/lib/i18n-session";
import { tr } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function DaycareSettingsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  const { dict } = await i18nForAccount(session.accountId);
  const { id } = await params;
  const base = `/platform/daycares/${id}/settings`;
  const entries = [
    { href: `${base}/billing`, key: "settingsNavBilling" },
    { href: `${base}/invoices`, key: "settingsNavInvoices" },
    { href: `${base}/center`, key: "settingsNavCenter" },
  ];

  return (
    <div>
      <nav
        className="card mb-4"
        aria-label={tr(dict, "platform.settingsSectionTitle")}
        style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}
      >
        <strong style={{ marginInlineEnd: 4 }}>
          {tr(dict, "platform.settingsSectionTitle")}
        </strong>
        {entries.map((entry) => (
          <a
            key={entry.href}
            href={entry.href}
            className="btn"
            style={{ textDecoration: "none" }}
          >
            {tr(dict, `platform.${entry.key}`)}
          </a>
        ))}
      </nav>
      {children}
    </div>
  );
}
