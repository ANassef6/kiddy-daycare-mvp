// KID-227: copies a daycare's public URL (https://<prefix>.<apex>) to the
// clipboard, so the operator can paste the address wherever it is needed —
// the board could not tell what the subdomain field produced. Labels arrive
// translated from the server page (this component stays string-free i18n-wise).
// Clipboard failures are logged, never swallowed silently, and the button
// keeps its label so the operator knows nothing was copied.
"use client";

import { useState } from "react";

export default function CopyUrlButton({
  url,
  copyLabel,
  copiedLabel,
}: {
  url: string;
  copyLabel: string;
  copiedLabel: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-ghost"
      style={{ padding: "2px 10px", fontSize: 12 }}
      title={url}
      aria-label={`${copyLabel}: ${url}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch (err) {
          console.error("KID-227 copy to clipboard failed:", err);
        }
      }}
    >
      {copied ? copiedLabel : copyLabel}
    </button>
  );
}
