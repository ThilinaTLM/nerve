import { Notification } from "../electron.js";
import type { DesktopNotificationPayload } from "../types.js";

export function showDesktopNotification(
  payload: unknown,
  showMainWindow: () => void | Promise<void>,
): { shown: boolean } {
  const notificationPayload = parseNotificationPayload(payload);
  if (!notificationPayload || !Notification.isSupported()) {
    return { shown: false };
  }

  const notification = new Notification({
    title: notificationPayload.title,
    body: notificationPayload.body,
    urgency:
      notificationPayload.urgency === "attention" ? "critical" : "normal",
  });
  notification.on("click", () => {
    void showMainWindow();
  });
  notification.show();
  return { shown: true };
}

function parseNotificationPayload(
  payload: unknown,
): DesktopNotificationPayload | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const candidate = payload as Record<string, unknown>;
  if (typeof candidate.title !== "string" || !candidate.title.trim()) {
    return undefined;
  }
  const urgency =
    candidate.urgency === "attention" || candidate.urgency === "normal"
      ? candidate.urgency
      : "normal";
  return {
    title: truncateNotificationText(candidate.title, 120),
    body:
      typeof candidate.body === "string"
        ? truncateNotificationText(candidate.body, 280)
        : undefined,
    urgency,
  };
}

function truncateNotificationText(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 1)}…`;
}
