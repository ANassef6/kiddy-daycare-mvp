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
  IMAGE_MIN_QUALITY,
  IMAGE_QUALITY,
  IMAGE_TARGET_BYTES,
  MAX_IMAGE_EDGE,
  MAX_VIDEO_DURATION_SECONDS,
  MAX_VIDEO_UPLOAD_BYTES,
  formatBytes,
  mediaKind,
  targetDimensions,
} from "@/lib/media-limits";
import { directUploadFile } from "@/lib/media-upload-client";

export type MediaUploadLabels = {
  preparing: string;
  optimizing: string;
  prepared: string;
  imageTooLarge: string;
  videoTooLarge: string;
  videoTooLong: string;
  fileTooLarge: string;
  compressFailed: string;
};

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
    purpose: "photo" | "proof" | "contract" | "drive" | "newsfeed" | "message";
    entityType?: string;
    entityId?: string;
    /** The file input's name. Defaults to "file". */
    fileField?: string;
  };
};

function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    vars[key] === undefined ? `{${key}}` : String(vars[key])
  );
}

async function decodeImage(file: File): Promise<ImageBitmap | HTMLImageElement | null> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // Older Safari / unsupported format — try the <img> path below.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function compressImage(file: File): Promise<File> {
  const type = file.type.toLowerCase();
  if (!type.startsWith("image/") || type === "image/gif" || type === "image/svg+xml") return file;
  const source = await decodeImage(file);
  if (!source) return file;
  const sourceWidth = source.width;
  const sourceHeight = source.height;
  const { width, height } = targetDimensions(sourceWidth, sourceHeight, MAX_IMAGE_EDGE);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    if ("close" in source) source.close();
    return file;
  }
  ctx.drawImage(source, 0, 0, width, height);
  if ("close" in source) source.close();

  let blob = await canvasToBlob(canvas, "image/webp", IMAGE_QUALITY);
  if (!blob) blob = await canvasToBlob(canvas, "image/jpeg", IMAGE_QUALITY);
  if (!blob) return file;
  let quality = IMAGE_QUALITY;
  while (blob.size > IMAGE_TARGET_BYTES && quality > IMAGE_MIN_QUALITY) {
    quality = Math.round((quality - 0.07) * 100) / 100;
    const next = await canvasToBlob(canvas, blob.type === "image/jpeg" ? "image/jpeg" : "image/webp", quality);
    if (!next) break;
    blob = next;
  }
  if (blob.size >= file.size) return file;
  const outputType = blob.type || "image/jpeg";
  const ext = outputType === "image/webp" ? "webp" : "jpg";
  const base = file.name.replace(/\.[^.]+$/, "") || "photo";
  return new File([blob], `${base}.${ext}`, { type: outputType, lastModified: Date.now() });
}

function probeVideoDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    let done = false;
    const finish = (value: number | null) => {
      if (done) return;
      done = true;
      URL.revokeObjectURL(url);
      resolve(value);
    };
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const seconds = video.duration;
      finish(Number.isFinite(seconds) && seconds > 0 ? seconds : null);
    };
    video.onerror = () => finish(null);
    window.setTimeout(() => finish(null), 8000);
    video.src = url;
  });
}

type Prepared =
  | { ok: true; formData: FormData; saved: number }
  | { ok: false; error: string };

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

  async function prepare(formData: FormData): Promise<Prepared> {
    const out = new FormData();
    let saved = 0;
    const targetField = directUpload?.fileField ?? "file";
    // KID-2453: replace the prepared bytes with its private REF when the
    // direct-upload ticket succeeds; the multipart field stays the fallback.
    const appendFile = async (key: string, file: File) => {
      if (directUpload && key === targetField) {
        setStatus(labels.preparing);
        const direct = await directUploadFile({
          file,
          purpose: directUpload.purpose,
          entityType: directUpload.entityType,
          entityId: directUpload.entityId,
        });
        if (direct.ok) {
          out.append(`${targetField}Ref`, direct.ref);
          out.append(`${targetField}Name`, file.name);
          return;
        }
        console.warn("KID-2453 direct upload unavailable, using the server path:", direct.reason);
      }
      out.append(key, file, file.name);
    };
    for (const [key, value] of formData.entries()) {
      if (!(value instanceof File) || value.size === 0) {
        out.append(key, value);
        continue;
      }
      const kind = mediaKind(value.type);
      try {
        if (kind === "image" && compressImages) {
          setStatus(labels.optimizing);
          const prepared = await compressImage(value);
          if (prepared.size > maxImageBytes) {
            return { ok: false, error: `${value.name}: ${fill(labels.imageTooLarge, { limit: formatBytes(maxImageBytes) })}` };
          }
          if (prepared.size < value.size) saved += value.size - prepared.size;
          await appendFile(key, prepared);
          continue;
        }
        if (kind === "video") {
          setStatus(labels.preparing);
          if (value.size > maxVideoBytes) {
            return { ok: false, error: `${value.name}: ${fill(labels.videoTooLarge, { limit: formatBytes(maxVideoBytes) })}` };
          }
          const seconds = await probeVideoDuration(value);
          if (seconds !== null && seconds > maxVideoSeconds) {
            return {
              ok: false,
              error: `${value.name}: ${fill(labels.videoTooLong, {
                seconds: Math.round(seconds),
                limit: maxVideoSeconds,
              })}`,
            };
          }
          await appendFile(key, value);
          continue;
        }
        const ceiling = maxFileBytes ?? maxVideoBytes;
        if (value.size > ceiling) {
          return { ok: false, error: `${value.name}: ${fill(labels.fileTooLarge, { limit: formatBytes(ceiling) })}` };
        }
        await appendFile(key, value);
      } catch {
        return { ok: false, error: `${value.name}: ${labels.compressFailed}` };
      }
    }
    return { ok: true, formData: out, saved };
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
        setStatus(fill(labels.prepared, { saved: formatBytes(prepared.saved) }));
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
