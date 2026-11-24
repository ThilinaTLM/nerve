/** What the "Notifications on this phone" row shows and offers. */
export type PushStatus =
  | "unsupported"
  | "needs-install"
  | "blocked"
  | "off"
  | "on";

export type PushEnvironment = {
  /** Service workers, Push API and Notification are all present. */
  apis: boolean;
  /** iOS only delivers web push to apps added to the Home Screen. */
  ios: boolean;
  standalone: boolean;
  permission: NotificationPermission | undefined;
  /** The daemon has a subscription for this device. */
  subscribed: boolean;
};

export function derivePushStatus(env: PushEnvironment): PushStatus {
  if (env.ios && !env.standalone) return "needs-install";
  if (!env.apis) return "unsupported";
  if (env.permission === "denied") return "blocked";
  return env.subscribed && env.permission === "granted" ? "on" : "off";
}

export const pushStatusLabel: Record<PushStatus, string> = {
  unsupported: "Not supported on this browser",
  "needs-install": "Add Nerve to your Home Screen first",
  blocked: "Blocked in browser settings",
  off: "Off",
  on: "On",
};
