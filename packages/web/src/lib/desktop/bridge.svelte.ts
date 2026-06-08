export interface DesktopWindowState {
  maximized: boolean;
  focused: boolean;
}

export interface DesktopNotificationPayload {
  title: string;
  body?: string;
  urgency?: "normal" | "attention";
}

export interface NerveDesktopBridge {
  kind: "electron";
  platform: string;
  window: {
    minimize: () => Promise<void>;
    toggleMaximize: () => Promise<void>;
    close: (options?: { closeToTray?: boolean }) => Promise<void>;
    getState: () => Promise<DesktopWindowState>;
    onStateChange: (
      listener: (state: DesktopWindowState) => void,
    ) => () => void;
  };
  settings: {
    setCloseToTray: (closeToTray: boolean) => Promise<void>;
  };
  notifications: {
    show: (payload: DesktopNotificationPayload) => Promise<{ shown: boolean }>;
  };
}

declare global {
  interface Window {
    nerveDesktop?: NerveDesktopBridge;
  }
}

const initialDesktopBridge = getDesktopBridge();

export const desktopRuntime = $state<{
  isDesktop: boolean;
  platform?: string;
  windowState: DesktopWindowState;
}>({
  isDesktop: initialDesktopBridge !== undefined,
  platform: initialDesktopBridge?.platform,
  windowState: {
    maximized: false,
    focused: true,
  },
});

export function getDesktopBridge(): NerveDesktopBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return window.nerveDesktop?.kind === "electron"
    ? window.nerveDesktop
    : undefined;
}

export function isDesktopApp(): boolean {
  return getDesktopBridge() !== undefined;
}

export function initializeDesktopRuntime(): () => void {
  const bridge = getDesktopBridge();
  desktopRuntime.isDesktop = bridge !== undefined;
  desktopRuntime.platform = bridge?.platform;
  if (!bridge) return () => undefined;

  let unsubscribe: () => void = () => undefined;
  void bridge.window
    .getState()
    .then((state) => {
      desktopRuntime.windowState = state;
    })
    .catch(() => undefined);

  unsubscribe = bridge.window.onStateChange((state) => {
    desktopRuntime.windowState = state;
  });

  return unsubscribe;
}

export async function minimizeDesktopWindow(): Promise<void> {
  await getDesktopBridge()?.window.minimize();
}

export async function toggleMaximizeDesktopWindow(): Promise<void> {
  await getDesktopBridge()?.window.toggleMaximize();
}

export async function closeDesktopWindow(options?: {
  closeToTray?: boolean;
}): Promise<void> {
  await getDesktopBridge()?.window.close(options);
}

export async function syncDesktopCloseToTray(
  closeToTray: boolean,
): Promise<void> {
  await getDesktopBridge()?.settings.setCloseToTray(closeToTray);
}

export async function showDesktopNotification(
  payload: DesktopNotificationPayload,
): Promise<{ shown: boolean }> {
  const bridge = getDesktopBridge();
  if (!bridge) return { shown: false };
  return bridge.notifications.show(payload).catch(() => ({ shown: false }));
}
