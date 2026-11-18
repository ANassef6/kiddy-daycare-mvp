import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/require";
import { getAccount, homeForRole, mustChangePasswordFor } from "@/lib/auth";
import { i18nForAccount } from "@/lib/i18n-session";
import { tr } from "@/lib/i18n";
import ChangePasswordCard from "@/components/ChangePasswordCard";

export const dynamic = "force-dynamic";

// KID-2439: the forced password-change screen. Every authenticated layout
// redirects a flagged account here, so it is the only app surface a temporary
// password can reach. A successful change clears must_change_password (see
// updateAccountPassword) and this page then offers the role's home screen.
export default async function ChangePasswordPage(props: {
  searchParams?: Promise<{ pw?: string }>;
}) {
  const session = await requireSession();
  const params = (await props.searchParams) ?? {};
  const account = await getAccount(session.accountId);
  if (!account) redirect("/login");
  const { dict } = await i18nForAccount(session.accountId);
  const mustChange = mustChangePasswordFor(account);

  return (
    <div className="container" style={{ maxWidth: 520, paddingTop: 60 }}>
      <h1 className="title">
        {tr(dict, mustChange ? "account.forcePasswordTitle" : "account.changePasswordTitle")}
      </h1>
      {mustChange && <p className="subtitle">{tr(dict, "account.forcePasswordHint")}</p>}
      <ChangePasswordCard dict={dict} status={params.pw} />
      {!mustChange && (
        <p>
          <Link className="btn btn-primary" href={homeForRole(session.role)}>
            {tr(dict, "account.forcePasswordContinue")}
          </Link>
        </p>
      )}
    </div>
  );
}
