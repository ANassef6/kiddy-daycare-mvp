"use client";

// KID-2453: browser side of the presigned upload handshake.
//
// Requests a short-lived R2 PUT ticket, uploads the prepared (already
// compressed) file directly to R2, and returns the private REF for the server
// action. Any failure returns ok:false so the form can fall back to the normal
// multipart submit — a direct-upload outage must never block an upload.

export type DirectUploadTicket = {
  uploadUrl: string;
  ref: string;
  headers: Record<string, string>;
  expiresIn: number;
};

export type DirectUploadResult =
  | { ok: true; ref: string }
  | { ok: false; reason: string };

/** PUT the file with XMLHttpRequest so the form can show real upload
 *  progress. `fetch` has no upload-progress event in browsers. */
function putWithProgress(
  url: string,
  headers: Record<string, string>,
  file: File,
  onProgress?: (percent: number) => void
): Promise<{ ok: boolean; status: number }> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [name, value] of Object.entries(headers)) {
      xhr.setRequestHeader(name, value);
    }
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || !event.total) return;
      onProgress?.(Math.min(100, Math.round((event.loaded / event.total) * 100)));
    };
    xhr.onload = () => resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status });
    xhr.onerror = () => resolve({ ok: false, status: 0 });
    xhr.onabort = () => resolve({ ok: false, status: 0 });
    xhr.send(file);
  });
}

export async function directUploadFile(opts: {
  file: File;
  purpose: "photo" | "proof" | "contract" | "drive" | "newsfeed" | "message" | "event";
  entityType?: string;
  entityId?: string;
  onProgress?: (percent: number) => void;
}): Promise<DirectUploadResult> {
  try {
    const ticketRes = await fetch("/api/media/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        purpose: opts.purpose,
        entityType: opts.entityType,
        entityId: opts.entityId,
        fileName: opts.file.name,
        contentType: opts.file.type || "application/octet-stream",
        size: opts.file.size,
      }),
    });
    if (!ticketRes.ok) {
      const detail = await ticketRes.text().catch(() => "");
      return { ok: false, reason: `presign ${ticketRes.status} ${detail.slice(0, 120)}` };
    }
    const ticket = (await ticketRes.json()) as DirectUploadTicket;
    opts.onProgress?.(0);
    const put = await putWithProgress(ticket.uploadUrl, ticket.headers, opts.file, opts.onProgress);
    if (!put.ok) return { ok: false, reason: `upload ${put.status}` };
    opts.onProgress?.(100);
    return { ok: true, ref: ticket.ref };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}
