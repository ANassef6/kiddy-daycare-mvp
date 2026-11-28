export type NotificationRoutePayload = Record<string, unknown>;

const NOTIFICATIONS = "/child/notifications";

function text(payload: NotificationRoutePayload, ...keys: string[]): string {
  for (const key of keys) {
    const value = payload[key];
    if (value !== null && value !== undefined && String(value) !== "") return String(value);
  }
  return "";
}

function anchor(base: string, id: string): string {
  return id ? `${base}#${id}` : base;
}

export function parentNotificationHref(
  kind: string,
  payload: NotificationRoutePayload = {}
): string {
  switch (kind) {
    case "message":
      return payload.threadId
        ? `/child/messages?thread=${encodeURIComponent(String(payload.threadId))}`
        : "/child/messages";
    case "announcement":
    case "newsfeed":
    case "newsfeed_post": {
      const postId = text(payload, "postId", "post_id");
      return anchor("/child/newsfeed", postId ? `post-${postId}` : "");
    }
    case "daily_report": {
      const childId = text(payload, "childId", "child_id");
      return childId ? `/child/${encodeURIComponent(childId)}` : NOTIFICATIONS;
    }
    case "invoice_created":
    case "invoice":
    case "billing": {
      const childId = text(payload, "childId", "child_id");
      return childId ? `/child/${encodeURIComponent(childId)}#invoices` : NOTIFICATIONS;
    }
    case "bus_on":
    case "bus_off":
    case "check_in":
    case "check_out":
    case "checkin":
    case "checkout":
    case "attendance":
    case "attendance_check_in":
    case "attendance_check_out": {
      const childId = text(payload, "childId", "child_id");
      return childId ? `/child/${encodeURIComponent(childId)}#attendance` : NOTIFICATIONS;
    }
    case "consent":
    case "consent_request":
    case "consent_created": {
      const consentId = text(payload, "consentId", "consent_id");
      return anchor("/child/consents", consentId ? `consent-${consentId}` : "");
    }
    case "incident":
    case "incident_created":
    case "accident": {
      const incidentId = text(payload, "incidentId", "incident_id");
      return anchor("/child/incidents", incidentId ? `incident-${incidentId}` : "");
    }
    case "event":
    case "event_created": {
      const eventId = text(payload, "eventId", "event_id");
      return anchor("/child/events", eventId ? `event-${eventId}` : "");
    }
    case "form":
    case "form_created":
    case "survey": {
      const formId = text(payload, "formId", "form_id");
      return formId ? `/child/forms?open=${encodeURIComponent(formId)}` : "/child/forms";
    }
    case "chatwoot_message":
      return "/child/support";
    case "test":
      return NOTIFICATIONS;
    default:
      return NOTIFICATIONS;
  }
}
