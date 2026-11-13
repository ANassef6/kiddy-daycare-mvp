// KID-112: the only relationship control. Exactly 4 required options —
// no free-text input anywhere. Server components import this directly.
import {
  CONTACT_RELATIONSHIPS,
  CONTACT_RELATIONSHIP_LABELS,
} from "@/lib/contact-relationship";

// KID-2400: server pages pass localized option labels (dict-derived); the
// English map stays the fallback so existing callers keep working unchanged.
export default function RelationshipSelect({
  name = "relationship",
  defaultValue = "parent",
  required = true,
  id,
  labels,
}: {
  name?: string;
  defaultValue?: string;
  required?: boolean;
  id?: string;
  labels?: Partial<Record<"parent" | "family" | "pickup" | "no_access", string>>;
}) {
  return (
    <select className="select" name={name} id={id} required={required} defaultValue={defaultValue}>
      {CONTACT_RELATIONSHIPS.map((value) => (
        <option key={value} value={value}>
          {labels?.[value] ?? CONTACT_RELATIONSHIP_LABELS[value]}
        </option>
      ))}
    </select>
  );
}
