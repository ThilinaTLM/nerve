export type QuitSource =
  | "startup-error"
  | "titlebar-close"
  | "native-window-close"
  | "tray-quit"
  | "signal"
  | "renderer"
  | "unknown";

export interface QuitOptions {
  source?: QuitSource;
  hideWindows?: boolean;
  signal?: NodeJS.Signals;
}
