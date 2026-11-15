// KID-2413 bug 6: attendance/pickup policy refusals used to be English-only
// strings returned straight from lib/working-hours.ts and lib/pickup-policy.ts.
// Those modules stay locale-agnostic (pure, testable); this adapter turns
// their machine-readable refusal codes into the active dictionary's message.
import { tr, type Dict } from "./i18n";
import type { CheckInErrorCode } from "./working-hours";
import type { PickupTimeCode, PickupTimeDecision } from "./pickup-policy";

type CheckInRefusal = { code?: CheckInErrorCode; day?: string; open?: string };

function dayName(dict: Dict, day: string | undefined): string {
  if (day === undefined) return "";
  return tr(dict, `policy.day${day}`);
}

/** Localized check-in refusal, or undefined when the gate allowed it. */
export function checkInPolicyError(dict: Dict, refusal: CheckInRefusal): string | undefined {
  if (refusal.code === "closed_day") {
    return tr(dict, "policy.closedDayCheckIn", { day: dayName(dict, refusal.day) });
  }
  if (refusal.code === "before_open") {
    return tr(dict, "policy.beforeOpenCheckIn", { open: refusal.open ?? "" });
  }
  return undefined;
}

/** Localized pickup-time refusal for a failed evaluatePickupTime decision. */
export function pickupPolicyError(
  dict: Dict,
  decision: Extract<PickupTimeDecision, { ok: false }>
): string {
  switch (decision.code) {
    case "invalid_time":
      return tr(dict, "policy.pickupInvalidTime");
    case "cross_day":
      return tr(dict, "policy.pickupCrossDay");
    case "past":
      return tr(dict, "policy.pickupPast");
    case "closed_day":
      return tr(dict, "policy.pickupClosedDay", { day: dayName(dict, decision.day) });
    case "outside_hours":
      return decision.detail === "before_open"
        ? tr(dict, "policy.pickupBeforeOpen", { open: decision.open ?? "" })
        : tr(dict, "policy.pickupAfterClose", { close: decision.close ?? "" });
    default:
      return tr(dict, "policy.checkInNotAllowed");
  }
}

export type { PickupTimeCode };
