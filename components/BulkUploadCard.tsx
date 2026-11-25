// KID-2478: the shared superadmin bulk-upload card. Rendered on the
// per-daycare Settings page (and the standalone bulk-upload route) so the
// templates, upload forms and report live in one place.
import Link from "next/link";
import { bulkUploadAction } from "@/lib/actions";
import { fmtDateTimeFor, tr, type Dict, type Locale } from "@/lib/i18n";
import type { BulkRowOutcome, StoredBulkUploadReport } from "@/lib/bulk-upload";

const ROW_MESSAGE_KEYS: Record<string, string> = {
  "duplicate-child": "platform.bulkUploadRow_duplicateChild",
  "duplicate-email": "platform.bulkUploadRow_duplicateEmail",
  names: "platform.bulkUploadRow_names",
  name: "platform.bulkUploadRow_name",
  dob: "platform.bulkUploadRow_dob",
  email: "platform.bulkUploadRow_email",
  "email-role": "platform.bulkUploadRow_emailRole",
  role: "platform.bulkUploadRow_role",
  classroom: "platform.bulkUploadRow_classroom",
  unknown: "platform.bulkUploadRow_unknown",
};

export const BULK_UPLOAD_ERROR_KEYS: Record<string, string> = {
  file: "platform.bulkUploadError_file",
  type: "platform.bulkUploadError_type",
  size: "platform.bulkUploadError_size",
  format: "platform.bulkUploadError_format",
  headers: "platform.bulkUploadError_headers",
  rows: "platform.bulkUploadError_rows",
  empty: "platform.bulkUploadError_empty",
  kind: "platform.bulkUploadError_kind",
  unknown: "platform.bulkUploadError_unknown",
};

function rowMessage(dict: Dict, row: BulkRowOutcome): string {
  if (row.status === "created") {
    return (row.warnings ?? [])
      .map((warning) =>
        warning === "classroom-not-found"
          ? tr(dict, "platform.bulkUploadWarning_classroomNotFound")
          : warning
      )
      .join(" ");
  }
  return tr(dict, ROW_MESSAGE_KEYS[row.message ?? "unknown"] ?? ROW_MESSAGE_KEYS.unknown);
}

function ReportTable({ report, dict }: { report: StoredBulkUploadReport; dict: Dict }) {
  return (
    <div className="card mb-4" id="bulk-report">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h3 className="subtitle" style={{ marginBottom: 4 }}>{tr(dict, "platform.bulkUploadReportTitle")}</h3>
          <p className="small muted" style={{ margin: 0 }}>
            {tr(dict, "platform.bulkUploadReportSummary", {
              total: report.totalRows,
              created: report.createdCount,
              skipped: report.skippedCount,
              errors: report.errorCount,
            })}
          </p>
        </div>
        <a className="btn" href={`/api/platform/bulk-upload/report/${encodeURIComponent(report.id)}`}>
          {tr(dict, "platform.bulkUploadReportDownload")}
        </a>
      </div>
      <div style={{ overflowX: "auto", marginTop: 12 }}>
        <table className="table" style={{ width: "100%", minWidth: 620 }}>
          <thead>
            <tr>
              <th>{tr(dict, "platform.bulkUploadRowLabel")}</th>
              <th>{tr(dict, "platform.passwordResetName")}</th>
              <th>{tr(dict, "platform.status")}</th>
              <th>{tr(dict, "platform.bulkUploadMessageLabel")}</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((row) => (
              <tr key={`${row.row}-${row.kind}`}>
                <td>{row.row}</td>
                <td>{row.name || "—"}</td>
                <td>
                  {row.status === "created"
                    ? tr(dict, "platform.bulkUploadStatusCreated")
                    : row.status === "skipped"
                      ? tr(dict, "platform.bulkUploadStatusSkipped")
                      : tr(dict, "platform.bulkUploadStatusError")}
                </td>
                <td>{rowMessage(dict, row)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export type BulkUploadCardProps = {
  instituteId: string;
  dict: Dict;
  locale: Locale;
  reports: StoredBulkUploadReport[];
  report: StoredBulkUploadReport | null;
  errorCode?: string;
  /** Where the "recent uploads" links point. Defaults to this Settings page. */
  basePath?: string;
};

export default function BulkUploadCard({
  instituteId,
  dict,
  locale,
  reports,
  report,
  errorCode,
  basePath,
}: BulkUploadCardProps) {
  const base = basePath ?? `/platform/daycares/${encodeURIComponent(instituteId)}/settings`;
  const errorKey = errorCode ? BULK_UPLOAD_ERROR_KEYS[errorCode] : undefined;

  const form = (kind: "children" | "staff", titleKey: string, hintKey: string) => (
    <form className="card mb-4" action={bulkUploadAction} encType="multipart/form-data">
      <h3 className="subtitle">{tr(dict, titleKey)}</h3>
      <p className="small muted">{tr(dict, hintKey)}</p>
      <input type="hidden" name="instituteId" value={instituteId} />
      <input type="hidden" name="kind" value={kind} />
      <div className="field">
        <label className="label" htmlFor={`${kind}-file`}>{tr(dict, "platform.bulkChooseFile")}</label>
        <input
          className="input"
          id={`${kind}-file`}
          name="file"
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          required
        />
        <p className="small muted">{tr(dict, "platform.bulkUploadLimit")}</p>
      </div>
      <div className="mt-3">
        <button className="btn btn-primary" type="submit">{tr(dict, "platform.bulkUploadBtn")}</button>
      </div>
    </form>
  );

  return (
    <section id="bulk-upload">
      <h2 className="subtitle" style={{ fontSize: 20 }}>{tr(dict, "platform.bulkUploadTitle")}</h2>
      <p className="small muted">{tr(dict, "platform.bulkUploadSubtitle")}</p>

      {errorKey && (
        <div role="alert" className="banner-error" style={{ padding: "10px 12px", marginBottom: 16, borderRadius: 8 }} dir="auto">
          <bdi>{tr(dict, errorKey)}</bdi>
        </div>
      )}

      <div className="card mb-4">
        <h3 className="subtitle">{tr(dict, "platform.bulkUploadTemplateTitle")}</h3>
        <p className="small muted">{tr(dict, "platform.bulkUploadTemplateHint")}</p>
        <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a binary download must not be a client-side <Link> */}
          <a className="btn" href="/api/platform/bulk-upload/template/children">
            {tr(dict, "platform.bulkChildrenTemplate")}
          </a>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a binary download must not be a client-side <Link> */}
          <a className="btn" href="/api/platform/bulk-upload/template/staff">
            {tr(dict, "platform.bulkStaffTemplate")}
          </a>
        </div>
      </div>

      {report && <ReportTable report={report} dict={dict} />}

      {form("children", "platform.bulkChildrenUploadTitle", "platform.bulkChildrenUploadHint")}
      {form("staff", "platform.bulkStaffUploadTitle", "platform.bulkStaffUploadHint")}

      <div className="card mb-4">
        <h3 className="subtitle">{tr(dict, "platform.bulkUploadRecent")}</h3>
        {reports.length === 0 ? (
          <p className="small muted" style={{ margin: 0 }}>{tr(dict, "platform.bulkUploadNoReports")}</p>
        ) : (
          <ul style={{ margin: 0, paddingInlineStart: 18 }}>
            {reports.map((item) => (
              <li key={item.id} style={{ marginBottom: 8 }}>
                <Link href={`${base}?report=${encodeURIComponent(item.id)}`}>
                  {item.kind === "children"
                    ? tr(dict, "platform.bulkChildrenTemplate")
                    : tr(dict, "platform.bulkStaffTemplate")}
                  {" · "}
                  {item.createdAt ? fmtDateTimeFor(locale, item.createdAt) : ""}
                </Link>
                {" — "}
                <span className="small muted">
                  {tr(dict, "platform.bulkUploadReportSummary", {
                    total: item.totalRows,
                    created: item.createdCount,
                    skipped: item.skippedCount,
                    errors: item.errorCount,
                  })}
                </span>
                {" "}
                <a className="small" href={`/api/platform/bulk-upload/report/${encodeURIComponent(item.id)}`}>
                  {tr(dict, "platform.bulkUploadReportDownload")}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
