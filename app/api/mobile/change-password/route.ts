import { NextRequest, NextResponse } from "next/server";
import { requireMobileSession } from "@/lib/mobile-api";
import { getAccount, updateAccountPassword, verifyPassword } from "@/lib/auth";
import {
  authAttemptGuard,
  recordAuthFailure,
  recordAuthSuccess,
  clientIpFrom,
} from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

function errorPayload(message: string, status: number, code: string) {
  return NextResponse.json({ error: message, code }, { status });
}

// KID-2439: the app-side leg of the forced password change. The mobile client
// opens this screen straight after login when `mustChangePassword` is set;
// requireMobileSession blocks every data route until the flag clears, so this
// endpoint is the only one a temporary password can use.
//
// Rules mirror the web changePasswordAction: the current password must verify,
// the new one is at least 8 characters, the confirmation must match, and the
// new password must differ from the current one. A successful change clears
// must_change_password in the same write as the new hash.
export async function POST(req: NextRequest) {
  const session = await requireMobileSession(req, { allowMustChangePassword: true });
  if (session instanceof NextResponse) return session;

  const ip = clientIpFrom(req.headers);
  const gate = await authAttemptGuard("mobile-change-password", ip, session.email);
  if (!gate.ok) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later.", code: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(gate.retryAfterSec) } }
    );
  }

  let body: {
    currentPassword?: unknown;
    newPassword?: unknown;
    confirmPassword?: unknown;
  } = {};
  try {
    body = await req.json();
  } catch {
    return errorPayload("Invalid JSON body.", 400, "invalid_body");
  }

  const current = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const next = typeof body.newPassword === "string" ? body.newPassword : "";
  const confirm = typeof body.confirmPassword === "string" ? body.confirmPassword : "";
  if (!current || !next || !confirm) {
    return errorPayload("All password fields are required.", 400, "missing_fields");
  }

  const account = await getAccount(session.accountId);
  if (!account) return errorPayload("account not found", 401, "not_signed_in");

  const stored = String(account.password_hash ?? "");
  if (!verifyPassword(current, stored)) {
    await recordAuthFailure("mobile-change-password", ip, session.email);
    return errorPayload("The current password is not correct.", 422, "wrong_current_password");
  }
  if (next.length < 8) {
    return errorPayload("The new password must be at least 8 characters.", 422, "password_too_short");
  }
  if (next !== confirm) {
    return errorPayload("The new passwords do not match.", 422, "password_mismatch");
  }
  if (next === current || verifyPassword(next, stored)) {
    return errorPayload(
      "The new password must be different from the current password.",
      422,
      "password_unchanged"
    );
  }

  await updateAccountPassword(session.accountId, next);
  await recordAuthSuccess(session.email);

  return NextResponse.json({
    ok: true,
    // The client uses this to open the normal app without another round trip.
    account: {
      id: account.id,
      email: account.email,
      role: account.role,
      fullName: account.full_name,
      mustChangePassword: false,
    },
  });
}
