// KID-246: best-effort email when an INVOICE IS CREATED for a daycare
// (Finance/3). Deliberately the same contract as lib/contact-notify.ts
// (KID-238) and lib/invite-email.ts:
//
//   - Delivery goes through the app's EXISTING shared mail path — the
//     Supabase GoTrue admin channel (SUPABASE_SERVICE_ROLE_KEY) — never a
//     new mail vendor, credential or SMTP dependency.
//   - With no provider configured this records + logs and continues
//     ("pending"): the in-app notification feed (recentActivityFeed,
//     ownerBillingFeedForInstance in lib/store.ts) is the primary channel
//     and never depends on email.
//   - GoTrue sends only its own templated mails, so the notification is the
//     provider's templated invite mail; the full built notification is
//     logged here so it can be forwarded manually.
//   - GoTrue rejects re-inviting an address that already has a user ("already
//     registered"). That outcome is recorded and never re-pretended.
//
// Nothing here ever throws — the invoicing sweep (lib/billing.ts) must stay
// atomic even when the mail path fails.

export type InvoiceNotifyStatus = "sent" | "pending" | "failed" | "skipped";

export type InvoiceNotifyOutcome = {
  status: InvoiceNotifyStatus;
  // Human-readable, safe for logs and the database (never includes secrets).
  detail: string;
};

/** The notification we would forward to the daycare owner. Pure so tests
 *  can assert the content; also the logged/forwardable body when the
 *  provider channel is unavailable. */
export function buildInvoiceNotificationEmail(args: {
  daycareName: string;
  ownerEmail: string;
  cycleMonth: string;
  totalAmount: number;
  currency: string;
  dueDate: string;
}): { to: string; subject: string; text: string } {
  const lines = [
    `A new invoice was generated for ${args.daycareName}:`,
    ``,
    `Billing cycle: ${args.cycleMonth}`,
    `Total: ${args.totalAmount} ${args.currency}`,
    `Due date: ${args.dueDate} (pay before then to keep the daycare open)`,
    ``,
    `Open Platform > Tools > Account billing in your portal to see the full invoice ledger.`,
  ];
  return {
    to: args.ownerEmail,
    subject: `New invoice for ${args.daycareName} — cycle ${args.cycleMonth}`,
    text: lines.join("\n"),
  };
}

// GoTrue's re-invite rejection, matched the same way the register flow
// matches it (lib/supabase isGoTrueAlreadyRegisteredError) but without
// importing the client module — a pure predicate keeps the notifier
// testable without a network.
export function isOwnerAlreadyRegisteredError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const message = String((err as Record<string, unknown>).message ?? "").toLowerCase();
  const status = (err as Record<string, unknown>).status;
  if (String(status) === "422") return true;
  return (
    message.includes("already registered") ||
    message.includes("already been registered") ||
    message.includes("email_exists")
  );
}

/** Providers/config description for the owner's GoTrue send, kept inline so
 *  the whole path mirrors contact-notify.ts without a shared mutable config. */
async function sendInviteMail(to: string): Promise<void> {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!serviceKey || !supabaseUrl) throw new Error("no-mail-provider");
  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await admin.auth.admin.inviteUserByEmail(to);
  if (error) throw error;
}

/** Attempt one best-effort owner email. Never throws; every outcome is a
 *  recorded result and a log line, never an error the billing sweep sees. */
export async function notifyInvoiceOwner(args: {
  daycareName: string;
  ownerEmail: string;
  cycleMonth: string;
  totalAmount: number;
  currency: string;
  dueDate: string;
}): Promise<InvoiceNotifyOutcome> {
  const preview = buildInvoiceNotificationEmail(args);

  // Degradation 1 — no provider: log + continue. The in-app feed carries the
  // notification regardless.
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!serviceKey || !supabaseUrl) {
    const detail =
      "no mail provider configured (SUPABASE_SERVICE_ROLE_KEY unset); invoice surfaced in the owner's in-app feed, email not sent";
    console.warn(`KID-246 invoice ${ownerTag(args)}: ${detail}\n${preview.text}`);
    return { status: "pending", detail };
  }

  try {
    await sendInviteMail(args.ownerEmail);
    console.log(
      `KID-246 invoice ${ownerTag(args)}: owner email accepted by provider for ${args.ownerEmail} (templated invite mail; invoice content logged for manual forwarding):\n${preview.text}`
    );
    return { status: "sent", detail: "owner email sent via the Supabase GoTrue path" };
  } catch (err) {
    if (isOwnerAlreadyRegisteredError(err)) {
      // Degradation 2 — the owner already has a provider user (the first
      // notification created it). Record clearly; never re-pretend a send.
      const detail =
        "owner email is already registered with the mail provider, so no further invite mail can be sent; notification stays in the in-app feed";
      console.warn(`KID-246 invoice ${ownerTag(args)}: ${detail}`);
      return { status: "failed", detail };
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`KID-246 invoice ${ownerTag(args)}: owner email to ${args.ownerEmail} failed:`, msg);
    return { status: "failed", detail: msg };
  }
}

function ownerTag(args: { daycareName: string; cycleMonth: string }): string {
  return `${args.daycareName}/${args.cycleMonth}`;
}
