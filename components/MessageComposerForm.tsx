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
// The labels and recipient copy are rendered by the server page, so every
// account locale keeps its exact copy — no dictionary lives here.
import { useTransition } from "react";

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
}: MessageComposerFormProps) {
  const [pending, start] = useTransition();
  return (
    <form
      className="row messages-composer"
      action={(fd) =>
        start(async () => {
          await action(fd);
        })
      }
    >
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
        disabled={pending}
        aria-busy={pending}
        data-testid="messages-send"
        data-pending={pending ? "true" : "false"}
      >
        {pending ? sendingLabel : sendLabel}
      </button>
    </form>
  );
}
