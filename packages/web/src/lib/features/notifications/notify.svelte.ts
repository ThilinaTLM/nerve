import { toast as sonnerToast } from "svelte-sonner";
import {
  type DesktopNotificationPayload,
  isDesktopApp,
  showDesktopNotification,
} from "$lib/features/desktop/state/desktop-bridge.svelte";

type BrowserPermission = NotificationPermission | "unsupported";
type NotifyKind = "success" | "error" | "message";

export type NotifyOptions = {
  description?: string;
  tag?: string;
};

export type NativeNotifyOptions = NotifyOptions & {
  backgroundOnly?: boolean;
  kind?: NotifyKind;
};

export const notificationState = $state<{
  initialized: boolean;
  browserSupported: boolean;
  permission: BrowserPermission;
  promptVisible: boolean;
  promptDismissed: boolean;
  lastRequestResult?: NotificationPermission;
}>({
  initialized: false,
  browserSupported: false,
  permission: "unsupported",
  promptVisible: false,
  promptDismissed: false,
  lastRequestResult: undefined,
});

let listenersInstalled = false;

// Direct notify.* calls are intentionally non-interruptive in-app
// feedback. OS/browser notifications must go through notifyNative(...) and the
// runtime notification policy.
export const notify = {
  success(title: string, options: NotifyOptions = {}): void {
    showToast("success", title, options.description);
  },
  error(title: string, options: NotifyOptions = {}): void {
    showToast("error", title, options.description);
  },
  message(title: string, options: NotifyOptions = {}): void {
    showToast("message", title, options.description);
  },
};

export function initializeNotifications(): void {
  syncNotificationState();
  notificationState.initialized = true;
  if (listenersInstalled || typeof window === "undefined") return;

  listenersInstalled = true;
  window.addEventListener("focus", syncNotificationState);
  document.addEventListener("visibilitychange", syncNotificationState);
}

export async function requestBrowserNotificationPermission(): Promise<void> {
  if (isDesktopApp() || !browserNotificationsSupported()) return;
  try {
    const result = await Notification.requestPermission();
    notificationState.lastRequestResult = result;
    notificationState.promptDismissed = true;
  } finally {
    syncNotificationState();
  }
}

export function dismissBrowserNotificationPrompt(): void {
  notificationState.promptDismissed = true;
  syncNotificationState();
}

export function notifyNative(
  payload: DesktopNotificationPayload,
  options: NativeNotifyOptions = {},
): void {
  const fallbackKind =
    options.kind ?? (payload.urgency === "attention" ? "error" : "message");
  deliverNativeNotification(payload, fallbackKind, options);
}

function deliverNativeNotification(
  payload: DesktopNotificationPayload,
  kind: NotifyKind,
  options: NativeNotifyOptions,
): void {
  if (options.backgroundOnly && documentIsActive()) return;

  syncNotificationState();

  if (isDesktopApp()) {
    void showDesktopNotification(payload);
    return;
  }

  if (browserNotificationsAllowed()) {
    showBrowserNotification(payload, options);
    return;
  }

  showToast(kind, payload.title, payload.body);
}

function showToast(
  kind: NotifyKind,
  title: string,
  description?: string,
): void {
  const options = description ? { description } : undefined;
  if (kind === "success") sonnerToast.success(title, options);
  else if (kind === "error") sonnerToast.error(title, options);
  else sonnerToast.message(title, options);
}

function showBrowserNotification(
  payload: DesktopNotificationPayload,
  options: NotifyOptions,
): void {
  try {
    const notification = new Notification(payload.title, {
      body: payload.body,
      tag: options.tag,
    });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  } catch {
    // If the browser reports granted permission but refuses construction, do not
    // fall back to a toast; granted native notifications remain the selected path.
  }
}

function syncNotificationState(): void {
  notificationState.browserSupported = browserNotificationsSupported();
  notificationState.permission = currentBrowserPermission();
  notificationState.promptVisible = shouldShowPermissionPrompt();
}

function shouldShowPermissionPrompt(): boolean {
  return (
    !isDesktopApp() &&
    notificationState.browserSupported &&
    notificationState.permission === "default" &&
    !notificationState.promptDismissed
  );
}

function browserNotificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

function browserNotificationsAllowed(): boolean {
  return (
    browserNotificationsSupported() && Notification.permission === "granted"
  );
}

function currentBrowserPermission(): BrowserPermission {
  return browserNotificationsSupported()
    ? Notification.permission
    : "unsupported";
}

function documentIsActive(): boolean {
  if (typeof document === "undefined") return false;
  return document.visibilityState === "visible" && document.hasFocus();
}
