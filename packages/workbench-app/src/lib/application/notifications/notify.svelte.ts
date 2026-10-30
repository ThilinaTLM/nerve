import type { NotificationTone } from "@nervekit/contracts/settings";
import { toast as sonnerToast } from "svelte-sonner";
import {
  type DesktopNotificationPayload,
  isDesktopApp,
  showDesktopNotification,
} from "$lib/platform/desktop/desktop-bridge.svelte";
import { initializeNotificationSoundPlayback } from "$lib/application/notifications/state/notification-sounds";

type BrowserPermission = NotificationPermission | "unsupported";
type NotifyKind = "success" | "error" | "message";
export type NotificationSoundEvent =
  | "question"
  | "planReview"
  | "approval"
  | "completed"
  | "failed";

export type NotifyOptions = {
  description?: string;
  tag?: string;
  /** A button on the toast; only toasts support it. */
  action?: { label: string; onClick: () => void };
  /** Toast lifetime in milliseconds. */
  duration?: number;
};

export type NotificationPreferences = {
  systemEnabled: boolean;
  soundsEnabled: boolean;
  events: Record<NotificationSoundEvent, NotificationTone>;
};

export const notificationState = $state<{
  initialized: boolean;
  browserSupported: boolean;
  permission: BrowserPermission;
  promptVisible: boolean;
  promptDismissed: boolean;
  lastRequestResult?: NotificationPermission;
  systemEnabled: boolean;
  soundsEnabled: boolean;
  eventSounds: Record<NotificationSoundEvent, NotificationTone>;
}>({
  initialized: false,
  browserSupported: false,
  permission: "unsupported",
  promptVisible: false,
  promptDismissed: false,
  lastRequestResult: undefined,
  systemEnabled: true,
  soundsEnabled: true,
  eventSounds: {
    question: "bell",
    planReview: "chime",
    approval: "bell",
    completed: "success",
    failed: "alert",
  },
});

let listenersInstalled = false;

// Direct notify.* calls are intentionally non-interruptive in-app
// feedback. OS/browser notifications must go through notifyNative(...) and the
// runtime notification policy.
export const notify = {
  success(title: string, options: NotifyOptions = {}): void {
    showToast("success", title, options);
  },
  error(title: string, options: NotifyOptions = {}): void {
    showToast("error", title, options);
  },
  warning(title: string, options: NotifyOptions = {}): void {
    sonnerToast.warning(title, {
      description: options.description,
      action: options.action,
      duration: options.duration,
    });
  },
  message(title: string, options: NotifyOptions = {}): void {
    showToast("message", title, options);
  },
};

export function initializeNotificationAudio(): () => void {
  return initializeNotificationSoundPlayback();
}

export function initializeNotifications(): void {
  notificationState.initialized = true;
  syncNotificationState();
  if (listenersInstalled || typeof window === "undefined") return;

  listenersInstalled = true;
  window.addEventListener("focus", syncNotificationState);
  document.addEventListener("visibilitychange", syncNotificationState);
}

export function configureNotificationPreferences(
  preferences: NotificationPreferences,
): void {
  notificationState.systemEnabled = preferences.systemEnabled;
  notificationState.soundsEnabled = preferences.soundsEnabled;
  notificationState.eventSounds = { ...preferences.events };
  syncNotificationState();
}

export async function requestBrowserNotificationPermission(): Promise<void> {
  if (
    !notificationState.systemEnabled ||
    isDesktopApp() ||
    !browserNotificationsSupported()
  ) {
    return;
  }
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

export type NativeNotifyOptions = {
  /** One system notification per tag; a newer one replaces the older one. */
  tag?: string;
  /** Opens whatever the notification is about (click, or the toast action). */
  onOpen?: () => void;
  kind?: NotifyKind;
};

/**
 * Shows a system (desktop/browser) notification, falling back to an in-app
 * toast when system notifications are off or unavailable. Sound, presence and
 * mute are decided by the attention delivery module, not here.
 */
export function notifyNative(
  payload: DesktopNotificationPayload,
  options: NativeNotifyOptions = {},
): void {
  const kind =
    options.kind ?? (payload.urgency === "attention" ? "error" : "message");
  const fallback = () =>
    showToast(kind, payload.title, {
      description: payload.body,
      id: options.tag,
      action: options.onOpen && { label: "Open", onClick: options.onOpen },
    });
  if (!notificationState.systemEnabled) return fallback();

  syncNotificationState();
  if (isDesktopApp()) {
    void showDesktopNotification(payload).then((result) => {
      if (!result.shown) fallback();
    });
  } else if (browserNotificationsAllowed()) {
    showBrowserNotification(payload, options);
  } else {
    fallback();
  }
}

/** In-app toast with an optional Open action. */
export function notifyToast(
  title: string,
  options: NotifyOptions & { id?: string; kind?: NotifyKind } = {},
): void {
  showToast(options.kind ?? "message", title, options);
}

function showToast(
  kind: NotifyKind,
  title: string,
  options: {
    description?: string;
    id?: string;
    action?: { label: string; onClick: () => void };
  } = {},
): void {
  const toastOptions = {
    description: options.description,
    id: options.id,
    action: options.action,
  };
  if (kind === "success") sonnerToast.success(title, toastOptions);
  else if (kind === "error") sonnerToast.error(title, toastOptions);
  else sonnerToast.message(title, toastOptions);
}

function showBrowserNotification(
  payload: DesktopNotificationPayload,
  options: NativeNotifyOptions,
): void {
  try {
    const notification = new Notification(payload.title, {
      body: payload.body,
      tag: options.tag,
      silent: true,
    });
    notification.onclick = () => {
      window.focus();
      notification.close();
      options.onOpen?.();
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
    notificationState.initialized &&
    notificationState.systemEnabled &&
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
