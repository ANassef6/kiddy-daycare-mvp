// KID-2450: server-side video duration guard.
//
// The browser enforces the 60s cap before upload, but an old or modified
// client must not be able to bypass it. No transcoder is installed, so for the
// containers phones actually produce (MP4 / MOV — ISO base media files) we
// read the `mvhd` header directly. Unknown containers return null and fall
// back to the byte-size cap, which is still enforced server-side.

type Box = { type: string; bodyStart: number; end: number };

function findBox(
  view: DataView,
  bytes: Uint8Array,
  start: number,
  end: number,
  type: string
): Box | null {
  let offset = start;
  while (offset + 8 <= end) {
    let size = view.getUint32(offset);
    const boxType = String.fromCharCode(
      bytes[offset + 4]!,
      bytes[offset + 5]!,
      bytes[offset + 6]!,
      bytes[offset + 7]!
    );
    let header = 8;
    if (size === 1) {
      if (offset + 16 > end) return null;
      const large = view.getBigUint64(offset + 8);
      if (large > BigInt(Number.MAX_SAFE_INTEGER)) return null;
      size = Number(large);
      header = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < header || offset + size > end) return null;
    if (boxType === type) return { type: boxType, bodyStart: offset + header, end: offset + size };
    offset += size;
  }
  return null;
}

/** Duration in seconds for MP4/MOV-style files, or null when the container is
 *  not parseable here (WebM, MKV, 3GP variants with unusual boxes). */
export function mp4DurationSeconds(input: ArrayBuffer | Uint8Array): number | null {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength < 16) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const moov = findBox(view, bytes, 0, bytes.byteLength, "moov");
  if (!moov) return null;
  const mvhd = findBox(view, bytes, moov.bodyStart, moov.end, "mvhd");
  if (!mvhd) return null;
  const body = mvhd.bodyStart;
  if (body + 4 > mvhd.end) return null;
  const version = view.getUint8(body);
  let timescale: number;
  let duration: number;
  if (version === 1) {
    if (body + 32 > mvhd.end) return null;
    timescale = view.getUint32(body + 20);
    const raw = view.getBigUint64(body + 24);
    duration = raw > BigInt(Number.MAX_SAFE_INTEGER) ? Infinity : Number(raw);
  } else if (version === 0) {
    if (body + 20 > mvhd.end) return null;
    timescale = view.getUint32(body + 12);
    duration = view.getUint32(body + 16);
  } else {
    return null;
  }
  if (!(timescale > 0) || !(duration > 0)) return null;
  return duration / timescale;
}
