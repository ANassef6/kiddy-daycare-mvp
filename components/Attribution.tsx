// KID-477: shared inline attribution line — "Created by … · when" beneath a
// record, with an "Updated by …" line when the record carries an edit trail.
// Renders nothing when there is no creator to show (legacy rows).
import { fmtDateTimeFor, getDictionary, tr, type Locale } from "@/lib/i18n";
import { DEFAULT_CENTER_TIMEZONE } from "@/lib/timezone";

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
  timeZone = DEFAULT_CENTER_TIMEZONE,
}: AttributionProps) {
  const hasCreated = !!createdBy && createdAt != null && createdAt !== "";
  const hasUpdated = !!updatedBy && updatedAt != null && updatedAt !== "";
  if (!hasCreated && !hasUpdated) return null;
  const dict = getDictionary(locale);
  return (
    <div className="small muted" style={{ marginTop: 4 }}>
      {hasCreated && (
        <div>
          {tr(dict, "audit.createdBy", { name: String(createdBy), when: fmtDateTimeFor(locale, createdAt, timeZone) })}
        </div>
      )}
      {hasUpdated && (
        <div>
          {tr(dict, "audit.updatedBy", { name: String(updatedBy), when: fmtDateTimeFor(locale, updatedAt, timeZone) })}
        </div>
      )}
    </div>
  );
}

// KID-2496: the center clock for the timestamp line (defaults to the
// platform zone for surfaces without a tenant, e.g. marketing previews).
type AttributionProps = AttributionRecord & { locale: Locale; timeZone?: string };
