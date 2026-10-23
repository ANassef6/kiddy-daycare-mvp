// KID-199.4r: the platform operator surface. Minimal chrome of its own — the
// operator resolves no tenant (lib/tenant.ts), so the /portal shell and its
// daycare styling do not apply here. The guard is the env-based operator
// allowlist (lib/platform.ts), NOT a daycare role — the ticket's core rule.
// KID-227: the chrome is .platform-shell (full-width single column) — the
// portal .shell grid built for the 220px sidebar squeezed the topbar here.
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
    <div dir={dir} className="platform-shell">
      <header className="platform-topbar">
        <strong>Kiddy</strong>
        <span className="small muted">{tr(dict, "platform.operator")} · {session.email}</span>
        <form action={logoutAction}>
          <button className="btn" type="submit">{tr(dict, "nav.signOut")}</button>
        </form>
      </header>
      <main className="platform-main">{children}</main>
    </div>
  );
}
