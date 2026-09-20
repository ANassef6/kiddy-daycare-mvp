import { requireSession } from "@/lib/require";
import { i18nForAccount } from "@/lib/i18n-session";
import LanguageSettingsCard from "@/components/LanguageSettingsCard";
import { tr } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function ParentSettingsPage() {
  const session = requireSession();
  const { locale, dict } = await i18nForAccount(session.accountId);

  return (
    <div>
      <h1 className="title">{tr(dict, "account.settingsTitle")}</h1>
      <LanguageSettingsCard locale={locale} dict={dict} />
    </div>
  );
}