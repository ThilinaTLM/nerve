import { pushSubscriptionSchema } from "@nervekit/contracts/access";
import {
  derivePushStatus,
  type PushEnvironment,
  type PushStatus,
} from "$lib/platform/push/push-status";
import {
  deletePushSubscription,
  getPushState,
  putPushSubscription,
  sendPushTest,
} from "../api/access.api";

/**
 * Web Push on this phone: browser permission and subscription on one side,
 * the daemon's copy of the subscription on the other. Only paired devices can
 * subscribe; the desktop shell has native notifications.
 */
export const pushNotifications = $state({
  status: "off" as PushStatus,
  loading: true,
  busy: false,
  error: undefined as string | undefined,
});

let publicKey: string | undefined;
let subscribedOnServer = false;

function isIos(): boolean {
  return (
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function environment(): PushEnvironment {
  return {
    apis:
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window,
    ios: isIos(),
    standalone: isStandalone(),
    permission: "Notification" in window ? Notification.permission : undefined,
    subscribed: subscribedOnServer,
  };
}

function refreshStatus(): void {
  pushNotifications.status = derivePushStatus(environment());
}

/** Reads the daemon's state for this device. Call when the row appears. */
export async function loadPushNotifications(): Promise<void> {
  pushNotifications.loading = true;
  try {
    const state = await getPushState();
    publicKey = state.publicKey;
    subscribedOnServer = state.subscribed;
    pushNotifications.error = undefined;
  } catch {
    pushNotifications.error = "Could not reach Nerve.";
  } finally {
    pushNotifications.loading = false;
    refreshStatus();
  }
}

async function browserSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

/** Must run from a tap: the permission prompt needs a user gesture. */
export async function enablePushNotifications(): Promise<void> {
  if (pushNotifications.busy) return;
  pushNotifications.busy = true;
  pushNotifications.error = undefined;
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return;
    if (!publicKey) throw new Error("Missing push key");
    const registration = await navigator.serviceWorker.ready;
    const subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: publicKey,
      }));
    await putPushSubscription(
      pushSubscriptionSchema.parse(subscription.toJSON()),
    );
    subscribedOnServer = true;
  } catch {
    pushNotifications.error = "Could not turn on notifications. Try again.";
  } finally {
    pushNotifications.busy = false;
    refreshStatus();
  }
}

export async function disablePushNotifications(): Promise<void> {
  if (pushNotifications.busy) return;
  pushNotifications.busy = true;
  pushNotifications.error = undefined;
  try {
    await deletePushSubscription();
    subscribedOnServer = false;
    await (await browserSubscription())?.unsubscribe();
  } catch {
    pushNotifications.error = "Could not turn off notifications. Try again.";
  } finally {
    pushNotifications.busy = false;
    refreshStatus();
  }
}

export async function sendTestPushNotification(): Promise<void> {
  pushNotifications.error = undefined;
  try {
    await sendPushTest();
  } catch {
    pushNotifications.error = "Could not send the test notification.";
  }
}
