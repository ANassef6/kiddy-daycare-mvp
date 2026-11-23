"use client";

// KID-2450: client-side media preparation before any upload leaves the device.
//
// Every upload form that carries photos/video is wrapped in this thin client
// form. It intercepts submit, prepares the selected files, then hands the SAME
// server action a transformed FormData:
//   * images are resized (longest edge 1280px) and re-encoded as WebP/JPEG
//     (~80% quality, ~400 KB target). Canvas re-encoding strips EXIF
//     geolocation; createImageBitmap/drawImage apply EXIF orientation first so
//     phone photos are not sideways.
//   * video is not transcoded. It is refused on the client when it exceeds the
//     duration or size limit, with a localized message, so the server never
//     answers a phone with a raw upload error.
//   * everything else passes through the same byte ceiling.
//
// The server mirrors every cap (lib/media-limits.ts), and the native form still
// posts normally if JS is unavailable (the browser then skips compression, and
// the server-side cap remains the backstop).

import { useEffect, useRef, useState, useTransition } from "react";
import {
  MAX_VIDEO_DURATION_SECONDS,
  MAX_VIDEO_UPLOAD_BYTES,
  formatBytes,
} from "@/lib/media-limits";
import {
  fillTemplate,
  prepareMediaFormData,
  type MediaPrepareLabels,
  type PreparedForm,
} from "@/lib/media-prepare-client";

export type MediaUploadLabels = MediaPrepareLabels;

type Props = {
  action: (formData: FormData) => Promise<void>;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  id?: string;
  encType?: string;
  maxImageBytes: number;
  maxVideoBytes?: number;
  maxVideoSeconds?: number;
  maxFileBytes?: number;
  compressImages?: boolean;
  labels: MediaUploadLabels;
  /** Optional aria label for the status region. */
  busyLabel?: string;
  /** KID-2453: when R2 is configured, stream the prepared file straight to
   *  private storage and submit its REF instead of the bytes. Falls back to
   *  the multipart field on any failure. */
  directUpload?: {
    purpose: "photo" | "proof" | "contract" | "drive" | "newsfeed" | "message" | "event";
    entityType?: string;
    entityId?: string;
    /** The file input's name. Defaults to "file". */
    fileField?: string;
  };
};

export default function MediaUploadForm({
  action,
  children,
  className,
  style,
  id,
  encType,
  maxImageBytes,
  maxVideoBytes = MAX_VIDEO_UPLOAD_BYTES,
  maxVideoSeconds = MAX_VIDEO_DURATION_SECONDS,
  maxFileBytes,
  compressImages = true,
  labels,
  busyLabel,
  directUpload,
}: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const blockSubmit = useRef(false);

  // A disabled submit button stops mouse taps; this stops Enter-key submits
  // while a file is still being prepared.
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const onSubmit = (event: SubmitEvent) => {
      if (blockSubmit.current) event.preventDefault();
    };
    form.addEventListener("submit", onSubmit);
    return () => form.removeEventListener("submit", onSubmit);
  }, []);

  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const buttons = form.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
      'button[type="submit"], input[type="submit"]'
    );
    for (const button of buttons) {
      if (busy || pending) {
        if (button.dataset.kid2450WasDisabled === undefined) {
          button.dataset.kid2450WasDisabled = button.disabled ? "1" : "0";
        }
        button.disabled = true;
      } else if (button.dataset.kid2450WasDisabled !== undefined) {
        button.disabled = button.dataset.kid2450WasDisabled === "1";
        delete button.dataset.kid2450WasDisabled;
      }
    }
  }, [busy, pending]);

  function prepare(formData: FormData): Promise<PreparedForm> {
    return prepareMediaFormData(formData, {
      maxImageBytes,
      maxVideoBytes,
      maxVideoSeconds,
      maxFileBytes,
      compressImages,
      labels,
      directUpload,
      onStatus: setStatus,
    });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (blockSubmit.current) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    setError("");
    setStatus("");
    blockSubmit.current = true;
    setBusy(true);
    try {
      const prepared = await prepare(new FormData(form));
      if (!prepared.ok) {
        setError(prepared.error);
        setBusy(false);
        blockSubmit.current = false;
        return;
      }
      if (prepared.saved > 0) {
        setStatus(fillTemplate(labels.prepared, { saved: formatBytes(prepared.saved) }));
      }
      startTransition(async () => {
        try {
          await action(prepared.formData);
        } catch (err) {
          // A server action that redirects throws a control-flow marker; only
          // real failures surface here.
          if (!(err instanceof Error) || !err.message.includes("NEXT_REDIRECT")) {
            console.error("KID-2450 media upload failed:", err);
            setError(labels.compressFailed);
            setBusy(false);
            blockSubmit.current = false;
          }
        }
      });
    } catch (err) {
      console.error("KID-2450 media preparation failed:", err);
      setError(labels.compressFailed);
      setBusy(false);
      blockSubmit.current = false;
    }
  }

  return (
    <form
      ref={formRef}
      id={id}
      className={className}
      style={style}
      encType={encType}
      action={action}
      onSubmit={handleSubmit}
      aria-busy={busy || pending}
    >
      {(busy || pending) && (
        <p
          className="small muted"
          role="status"
          aria-live="polite"
          style={{ margin: "0 0 8px", flexBasis: "100%" }}
        >
          {status || busyLabel || labels.preparing}
        </p>
      )}
      {error && (
        <p
          className="small"
          role="alert"
          style={{ margin: "0 0 8px", color: "#b91c1c", fontWeight: 600, flexBasis: "100%" }}
        >
          {error}
        </p>
      )}
      {/* display:contents keeps the parent form's own layout (flex/grid)
          exactly as it was before the wrapper existed. */}
      <div style={{ display: "contents" }}>{children}</div>
    </form>
  );
}
