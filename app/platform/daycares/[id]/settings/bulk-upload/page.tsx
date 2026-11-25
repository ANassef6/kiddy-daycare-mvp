// KID-2478 + KID-2477: the Bulk upload tab inside the per-daycare Settings
// section. Operator-only, same double check as every other /platform page.
import { redirect } from "next/navigation";
import Link from "next/link";
import { requireSession } from "@/lib/require";
import { isPlatformOperatorEmail, isPlatformOperatorRole } from "@/lib/platform";
import { getInstitute } from "@/lib/store";
import { i18nForAccount } from "@/lib/i18n-session";
import { tr } from "@/lib/i18n";
import BulkUploadCard from "@/components/BulkUploadCard";
import { getBulkUploadReport, listBulkUploadReports } from "@/lib/bulk-upload";

export const dynamic = "force-dynamic";

export default async function DaycareBulkUploadPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; report?: string }>;
}) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const session = await requireSession();
  if (!isPlatformOperatorRole(session.role) || !isPlatformOperatorEmail(session.email)) {
    redirect("/login");
  }
  const { dict, locale } = await i18nForAccount(session.accountId);
  const instituteId = String(params.id ?? "");
  const institute = await getInstitute(instituteId);
  if (!institute) redirect("/platform?error=missing-id");

  const reports = await listBulkUploadReports(instituteId);
  const selected = searchParams.report ? await getBulkUploadReport(searchParams.report) : null;
  const report = selected && selected.instituteId === instituteId ? selected : null;
  const settingsHref = `/platform/daycares/${encodeURIComponent(instituteId)}/settings`;

  return (
    <div>
      <p className="small" style={{ marginBottom: 8 }}>
        <Link href={settingsHref}>← {tr(dict, "platform.bulkUploadBack")}</Link>
      </p>
      <h1 className="title">
        {tr(dict, "platform.bulkUploadTitle")} — {String(institute.name ?? "")}
      </h1>
      <p className="subtitle">{tr(dict, "platform.bulkUploadSubtitle")}</p>

      <BulkUploadCard
        instituteId={instituteId}
        dict={dict}
        locale={locale}
        reports={reports}
        report={report}
        errorCode={searchParams.error}
        basePath={`/platform/daycares/${encodeURIComponent(instituteId)}/settings/bulk-upload`}
      />
    </div>
  );
}
