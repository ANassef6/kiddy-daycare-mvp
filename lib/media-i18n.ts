// KID-2450: server-side builder for the client form's localized labels. The
// dictionary stays on the server; the client component receives plain strings
// with {limit}/{seconds}/{saved} placeholders it fills at runtime.
import { tr, type Dict } from "@/lib/i18n";
import type { MediaUploadLabels } from "@/components/MediaUploadForm";

export function mediaUploadLabels(dict: Dict): MediaUploadLabels {
  return {
    preparing: tr(dict, "media.preparing"),
    optimizing: tr(dict, "media.optimizing"),
    prepared: tr(dict, "media.prepared"),
    imageTooLarge: tr(dict, "media.imageTooLarge"),
    videoTooLarge: tr(dict, "media.videoTooLarge"),
    videoTooLong: tr(dict, "media.videoTooLong"),
    fileTooLarge: tr(dict, "media.fileTooLarge"),
    compressFailed: tr(dict, "media.compressFailed"),
  };
}
