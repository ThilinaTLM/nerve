export interface DesktopWindowState {
  maximized: boolean;
  focused: boolean;
}

export interface DesktopNotificationPayload {
  title: string;
  body?: string;
  urgency?: "normal" | "attention";
}

export type QuitSource =
  | "startup-error"
  | "titlebar-close"
  | "native-window-close"
  | "tray-quit"
  | "signal"
  | "unknown";

export interface QuitOptions {
  source?: QuitSource;
  hideWindows?: boolean;
  signal?: NodeJS.Signals;
}

export interface DesktopCliOptions {
  mode?: "local" | "remote";
  remoteUrl?: string;
  token?: string;
  host?: string;
  port?: number;
  allowRemote?: boolean;
}
