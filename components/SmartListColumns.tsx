"use client";

const ALL = { name: "Name", dob: "DOB", age: "Age", gender: "Gender", room: "Room", allergies: "Allergies" } as const;

// KID-53 #5: smart-list column chooser. Appends/removes CSV columns through
// the page's GET params so the download honors the chosen columns.
export default function SmartListColumns({
  cols,
  qs,
  builderName,
  labels = { addColumnOption: "+ Add column…", columns: ALL },
}: {
  cols: string[];
  qs: string;
  builderName: string;
  labels?: { addColumnOption: string; columns: Record<string, string> };
}) {
  const urlWith = (colsNext: string[]) =>
    `/portal/tags?${qs.replace(/cols=[^&]+|cols=&/i, `cols=${encodeURIComponent(colsNext.join(","))}`)}&list=${encodeURIComponent(builderName)}`;

  return (
    <select
      className="select"
      value=""
      onChange={(e) => {
        const v = e.target.value;
        if (!v) return;
        window.location.href = urlWith(Array.from(new Set([...cols, v])));
      }}
    >
      <option value="">{labels.addColumnOption}</option>
      {Object.entries(labels.columns).map(([key, label]) =>
        cols.includes(key) ? null : (
          <option key={key} value={key}>
            {label}
          </option>
        )
      )}
    </select>
  );
}