import type { Settings } from "@nervekit/contracts/settings";
import type { BrowserWindowType } from "../platform/electron/electron-api.js";
export type { BrowserWindowType } from "../platform/electron/electron-api.js";
import type {
  EnsureDaemonOptions,
  ManagedDaemon,
} from "../daemon/contracts.js";
import type {
  DesktopPerformanceMonitor,
  DesktopPerformanceMonitorOptions,
} from "../performance/performance-monitor.js";
import type {
  TrayController,
  TrayControllerDependencies,
} from "../tray/tray.js";
export type { TrayController } from "../tray/tray.js";
import type { QuitSource } from "./quit-contracts.js";

export interface BeforeQuitEvent {
  preventDefault(): void;
}

export interface DesktopApplicationLifecyclePort {
  whenReady(): Promise<void>;
  onSecondInstance(listener: () => void): () => void;
  onActivate(listener: () => void): () => void;
  onWindowAllClosed(listener: () => void): () => void;
  onChildProcessGone(
    listener: (details: Record<string, unknown>) => void,
  ): () => void;
  onBeforeQuit(listener: (event: BeforeQuitEvent) => void): () => void;
  quit(): void;
  getAppMetrics(): DesktopPerformanceMonitorOptions["getMetrics"] extends () => infer Metrics
    ? Metrics
    : never;
  readonly platform: NodeJS.Platform;
  readonly architecture: string;
  readonly electronVersion: string | undefined;
  readonly chromeVersion: string | undefined;
}

export interface DesktopProcessSignalPort {
  onSignal(
    signal: "SIGINT" | "SIGTERM",
    listener: (signal: "SIGINT" | "SIGTERM") => void,
  ): () => void;
}

export interface DesktopWindowRegistryPort {
  getAllWindows(): BrowserWindowType[];
  createMainWindow(options: {
    daemonUrl: () => string | undefined;
    isTrustedShellUrl: (url: string) => boolean;
    isAppQuitting: () => boolean;
    closeWindowOrQuit: (window: BrowserWindowType, source?: QuitSource) => void;
    sendWindowState: (window: BrowserWindowType) => void;
  }): BrowserWindowType;
}

export interface DesktopRuntimePorts {
  application: DesktopApplicationLifecyclePort;
  signals: DesktopProcessSignalPort;
  windows: DesktopWindowRegistryPort;
  nativeTheme: {
    onUpdated(listener: () => void): () => void;
  };
  prepareDataDirectory(input: {
    home: string;
    mode?: "local" | "remote";
  }): Promise<{ status: "ready" | "quit" }>;
  readCurrentSettings(dataDir: string): Promise<Settings>;
  configureNetworkSession(): Promise<void>;
  acquireDaemon(options: EnsureDaemonOptions): Promise<ManagedDaemon>;
  installDaemonCookie(daemon: ManagedDaemon): Promise<void>;
  refreshDesktopSettings(daemon: ManagedDaemon): Promise<Settings | undefined>;
  registerIpc(options: {
    getCloseToTray: () => boolean;
    setCloseToTray: (value: boolean) => void;
    closeWindowOrQuit: (window: BrowserWindowType, source?: QuitSource) => void;
    sendWindowState: (window: BrowserWindowType) => void;
    showDesktopNotification: (payload: unknown) => { shown: boolean };
    getDaemonCapability: () => {
      mode: ManagedDaemon["mode"] | undefined;
      owned: boolean;
      canRestart: boolean;
    };
    restartDaemon: () => Promise<void>;
  }): () => void;
  showDesktopNotification(
    payload: unknown,
    showMainWindow: () => Promise<void>,
  ): { shown: boolean };
  createTray(dependencies: TrayControllerDependencies): TrayController;
  installPerformanceMonitor(
    options: DesktopPerformanceMonitorOptions,
  ): DesktopPerformanceMonitor;
  packagedWebDistPath(): string | undefined;
  now(): number;
}
