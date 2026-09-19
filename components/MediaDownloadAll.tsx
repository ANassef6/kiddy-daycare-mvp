"use client";

import { useState } from "react";

// KID-55 #6: download all of a child's media files in one go.
export default function MediaDownloadAll({ files }: { files: { url: string; caption?: string }[] }) {
  const [busy, setBusy] = useState(false);

  const downloadAll = async () => {
    if (files.length === 0 || busy) return;
    setBusy(true);
    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const res = await fetch(f.url);
        const blob = await res.blob();
        const ext = (blob.type.split("/")[1] || "jpg").split("+")[0];
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = f.caption ? `${String(i + 1).padStart(2, "0")}-${f.caption}.${ext}` : `media-${i + 1}.${ext}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        // Small pause so the browser doesn't block the burst.
        await new Promise((r) => setTimeout(r, 400));
      }
    } finally {
      setBusy(false);
    }
  };

  if (files.length === 0) return null;
  return (
    <button type="button" className="btn btn-ghost small" onClick={downloadAll} disabled={busy}>
      {busy ? "Downloading…" : `Download all (${files.length})`}
    </button>
  );
}
