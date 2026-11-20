"use client";

// KID-475: the parent composer's send gave zero feedback while its server
// action ran — on a phone the parent pressed send and nothing on screen
// responded, so the tap looked broken even while it was in flight. This is the
// same shape the portal already uses for attendance check-in (a client form
// that runs the server action inside a transition): the pending state lives in
// useTransition, so the button flips to a localized "Sending…" label, disables
// itself, and reports aria-busy while the action runs, with no JS-free
// fallback lost (the form still posts through the action reference).
//
// KID-2455: when the caller passes `attachments`, the composer also renders an
// attach control and runs the same preparation pipeline as MediaUploadForm
// (compress photos, cap video, direct-upload REF when R2 is available). A send
// without a file still works exactly as before.
//
// The labels and recipient copy are rendered by the server page, so every
// account locale keeps its exact copy — no dictionary lives here.
import { useState, useTransition } from "react";
import {
  prepareMediaFormData,
  type MediaDirectUpload,
  type MediaPrepareLabels,
} from "@/lib/media-prepare-client";

export type MessageComposerAttachments = {
  maxImageBytes: number;
  maxVideoBytes?: number;
  maxVideoSeconds?: number;
  maxFileBytes?: number;
  labels: MediaPrepareLabels;
  attachLabel: string;
  directUpload?: MediaDirectUpload;
};

export type MessageComposerFormProps = {
  action: (formData: FormData) => Promise<void>;
  sendLabel: string;
  sendingLabel: string;
  placeholder: string;
  /** Direct composer: the recipient picker options (label = full_name). */
  recipientOptions?: { id: string; label: string }[];
  defaultRecipientId?: string;
  /** Thread reply: the server resolves the participants, the recipient is fixed. */
  hiddenRecipientId?: string;
  threadId?: string;
  /** KID-2455: optional attach control. Omit to keep the text-only composer. */
  attachments?: MessageComposerAttachments;
};

export default function MessageComposerForm({
  action,
  sendLabel,
  sendingLabel,
  placeholder,
  recipientOptions,
  defaultRecipientId,
  hiddenRecipientId,
  threadId,
  attachments,
}: MessageComposerFormProps) {
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (!attachments) return;
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    setError("");
    setStatus("");
    setBusy(true);
    try {
      const prepared = await prepareMediaFormData(new FormData(form), {
        maxImageBytes: attachments.maxImageBytes,
        maxVideoBytes: attachments.maxVideoBytes,
        maxVideoSeconds: attachments.maxVideoSeconds,
        maxFileBytes: attachments.maxFileBytes,
        labels: attachments.labels,
        directUpload: attachments.directUpload,
        onStatus: setStatus,
      });
      if (!prepared.ok) {
        setError(prepared.error);
        setBusy(false);
        return;
      }
      start(async () => {
        try {
          await action(prepared.formData);
        } catch (err) {
          // A server action that redirects throws a control-flow marker; only
          // real failures surface here.
          if (!(err instanceof Error) || !err.message.includes("NEXT_REDIRECT")) {
            console.error("KID-2455 message attachment send failed:", err);
            setError(attachments.labels.compressFailed);
          }
        } finally {
          // The redirect can keep this client component mounted on the same
          // page, so `busy` must clear explicitly or the button stays on
          // "Sending…" until a manual refresh.
          setBusy(false);
        }
      });
    } catch (err) {
      console.error("KID-2455 message attachment preparation failed:", err);
      setError(attachments.labels.compressFailed);
      setBusy(false);
    }
  }

  const blocked = pending || busy;
  return (
    <form
      className="row messages-composer"
      action={(fd) =>
        start(async () => {
          await action(fd);
        })
      }
      onSubmit={attachments ? handleSubmit : undefined}
      aria-busy={blocked}
    >
      {(busy || pending) && status && (
        <p className="small muted" role="status" aria-live="polite" style={{ margin: 0, flexBasis: "100%" }}>
          {status}
        </p>
      )}
      {error && (
        <p className="small" role="alert" style={{ margin: 0, flexBasis: "100%", color: "#b91c1c", fontWeight: 600 }}>
          {error}
        </p>
      )}
      {threadId && <input type="hidden" name="threadId" value={threadId} />}
      {hiddenRecipientId && <input type="hidden" name="recipientId" value={hiddenRecipientId} />}
      {recipientOptions && recipientOptions.length > 0 && (
        <select className="input" name="recipientId" defaultValue={defaultRecipientId}>
          {recipientOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      )}
      {attachments && (
        <label
          className="btn btn-ghost small"
          title={attachments.attachLabel}
          style={{ cursor: "pointer", flex: "0 0 auto", margin: 0 }}
          data-testid="messages-attach"
        >
          <span aria-hidden="true">📎</span> {attachments.attachLabel}
          <input
            type="file"
            name="attachment"
            accept="image/*,video/*,application/pdf"
            disabled={blocked}
            style={{ display: "none" }}
          />
        </label>
      )}
      <input
        className="input"
        name="body"
        placeholder={placeholder}
        required
        data-testid="messages-input"
      />
      <button
        className="btn btn-primary"
        type="submit"
        disabled={blocked}
        aria-busy={blocked}
        data-testid="messages-send"
        data-pending={blocked ? "true" : "false"}
      >
        {blocked ? sendingLabel : sendLabel}
      </button>
    </form>
  );
}
