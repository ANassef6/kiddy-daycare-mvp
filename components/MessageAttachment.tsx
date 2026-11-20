// KID-2455: render one message attachment inside a bubble.
//
// `src` is already resolved by the authenticated media path (storageSrcFor) on
// the server; this component never turns a stored REF into a public URL. Images
// preview inline, every other file becomes a chip with the original name.

import { attachmentKind } from "@/lib/media-limits";

type Props = {
  src: string;
  name: string;
  url?: string | null;
  downloadLabel: string;
};

export default function MessageAttachment({ src, name, url, downloadLabel }: Props) {
  const kind = attachmentKind(name, url);
  if (kind === "image") {
    return (
      <a href={src} target="_blank" rel="noreferrer" style={{ display: "block", marginTop: 6 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={name}
          style={{ display: "block", maxWidth: 200, maxHeight: 200, borderRadius: 8, objectFit: "cover" }}
        />
      </a>
    );
  }
  return (
    <p className="small" style={{ margin: "6px 0 0" }}>
      <a href={src} download={name} title={downloadLabel}>
        📎 {name}
      </a>
    </p>
  );
}
