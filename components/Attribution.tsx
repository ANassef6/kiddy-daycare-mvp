// KID-477: shared inline attribution line — "Created by … · when" beneath a
// record, with an "Updated by …" line when the record carries an edit trail.
// Renders nothing when there is no creator to show (legacy rows).
import { fmtDateTimeFor, getDictionary, tr, type Locale } from "@/lib/i18n";

export type AttributionRecord = {
  createdBy?: string | null;
  createdAt?: unknown;
  updatedBy?: string | null;
  updatedAt?: unknown;
};

export default function Attribution({
  locale,
  createdBy,
  createdAt,
  updatedBy,
  updatedAt,
}: AttributionProps) {
  const hasCreated = !!createdBy && createdAt != null && createdAt !== "";
  const hasUpdated = !!updatedBy && updatedAt != null && updatedAt !== "";
  if (!hasCreated && !hasUpdated) return null;
  const dict = getDictionary(locale);
  return (
    <div className="small muted" style={{ marginTop: 4 }}>
      {hasCreated && (
        <div>
          {tr(dict, "audit.createdBy", { name: String(createdBy), when: fmtDateTimeFor(locale, createdAt) })}
        </div>
      )}
      {hasUpdated && (
        <div>
          {tr(dict, "audit.updatedBy", { name: String(updatedBy), when: fmtDateTimeFor(locale, updatedAt) })}
        </div>
      )}
    </div>
  );
}

type AttributionProps = AttributionRecord & { locale: Locale };
