"use client";

// KID-2450 / KID-2455: shared client-side media preparation.
//
// Extracted from components/MediaUploadForm.tsx so every composer (the rich
// media forms and the compact message composers) runs the same pipeline before
// any byte leaves the device: resize + re-encode photos, probe/refuse oversized
// video, enforce the byte cap, then either stream to private storage and submit
// the verified REF (KID-2453) or fall back to a normal multipart field.

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

export type MediaPrepareLabels = {
  preparing: string;
  optimizing: string;
  prepared: string;
  imageTooLarge: string;
  videoTooLarge: string;
  videoTooLong: string;
  fileTooLarge: string;
  compressFailed: string;
};

export type MediaDirectUpload = {
  purpose: "photo" | "proof" | "contract" | "drive" | "newsfeed" | "message" | "event";
  entityType?: string;
  entityId?: string;
  /** The file input's name. Defaults to "file". */
  fileField?: string;
};

export type MediaPrepareOptions = {
  maxImageBytes: number;
  maxVideoBytes?: number;
  maxVideoSeconds?: number;
  maxFileBytes?: number;
  compressImages?: boolean;
  labels: MediaPrepareLabels;
  directUpload?: MediaDirectUpload;
  onStatus?: (status: string) => void;
};

export type PreparedForm =
  | { ok: true; formData: FormData; saved: number }
  | { ok: false; error: string };

export function fillTemplate(template: string, vars: Record<string, string | number>): string {
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

/** Prepare every file in the form, preserving all non-file fields. */
export async function prepareMediaFormData(
  formData: FormData,
  opts: MediaPrepareOptions
): Promise<PreparedForm> {
  const {
    maxImageBytes,
    maxVideoBytes = MAX_VIDEO_UPLOAD_BYTES,
    maxVideoSeconds = MAX_VIDEO_DURATION_SECONDS,
    maxFileBytes,
    compressImages = true,
    labels,
    directUpload,
    onStatus,
  } = opts;
  const out = new FormData();
  let saved = 0;
  const targetField = directUpload?.fileField ?? "file";
  const appendFile = async (key: string, file: File) => {
    if (directUpload && key === targetField) {
      onStatus?.(labels.preparing);
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
        onStatus?.(labels.optimizing);
        const prepared = await compressImage(value);
        if (prepared.size > maxImageBytes) {
          return { ok: false, error: `${value.name}: ${fillTemplate(labels.imageTooLarge, { limit: formatBytes(maxImageBytes) })}` };
        }
        if (prepared.size < value.size) saved += value.size - prepared.size;
        await appendFile(key, prepared);
        continue;
      }
      if (kind === "video") {
        onStatus?.(labels.preparing);
        if (value.size > maxVideoBytes) {
          return { ok: false, error: `${value.name}: ${fillTemplate(labels.videoTooLarge, { limit: formatBytes(maxVideoBytes) })}` };
        }
        const seconds = await probeVideoDuration(value);
        if (seconds !== null && seconds > maxVideoSeconds) {
          return {
            ok: false,
            error: `${value.name}: ${fillTemplate(labels.videoTooLong, {
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
        return { ok: false, error: `${value.name}: ${fillTemplate(labels.fileTooLarge, { limit: formatBytes(ceiling) })}` };
      }
      await appendFile(key, value);
    } catch {
      return { ok: false, error: `${value.name}: ${labels.compressFailed}` };
    }
  }
  return { ok: true, formData: out, saved };
}
