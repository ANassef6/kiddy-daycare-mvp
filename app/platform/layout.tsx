// KID-199.4r: the platform operator surface. Minimal chrome of its own — the
// operator resolves no tenant (lib/tenant.ts), so the /portal shell and its
// daycare styling do not apply here. The guard is the env-based operator
// allowlist (lib/platform.ts), NOT a daycare role — the ticket's core rule.
import { logoutAction } from "@/lib/actions";
import { requireSession } from "@/lib/require";
import { isPlatformOperatorEmail, isPlatformOperatorRole } from "@/lib/platform";
import { redirect } from "next/navigation";
import { i18nForAccount } from "@/lib/i18n-session";
import { tr } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const session = requireSession();
  // Per-page guard — there is no middleware in this app (same shape as
  // app/portal/settings/page.tsx, with the platform operator sentinel).
  if (!isPlatformOperatorRole(session.role) || !isPlatformOperatorEmail(session.email)) {
    redirect("/login");
  }
  const { locale, dict, dir } = await i18nForAccount(session.accountId);
  return (
    <div dir={dir} className="shell">
      <header className="portal-topbar" style={{ padding: "12px 20px", borderBottom: "1px solid #e5e7eb" }}>
        <strong>Kiddy</strong>
        <span className="small muted">{tr(dict, "platform.operator")} · {session.email}</span>
        <form action={logoutAction} style={{ marginLeft: "auto" }}>
          <button className="btn" type="submit">{tr(dict, "nav.signOut")}</button>
        </form>
      </header>
      <main className="shell-main" style={{ padding: 20 }}>{children}</main>
    </div>
  );
}
