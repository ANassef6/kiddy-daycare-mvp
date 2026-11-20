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

export async function directUploadFile(opts: {
  file: File;
  purpose: "photo" | "proof" | "contract" | "drive" | "newsfeed" | "message";
  entityType?: string;
  entityId?: string;
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
    const put = await fetch(ticket.uploadUrl, {
      method: "PUT",
      headers: ticket.headers,
      body: opts.file,
    });
    if (!put.ok) return { ok: false, reason: `upload ${put.status}` };
    return { ok: true, ref: ticket.ref };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}
