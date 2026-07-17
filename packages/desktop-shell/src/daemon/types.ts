import type { DaemonFile } from "@nervekit/contracts";

export type DaemonMode = "local" | "remote";

/** Lifecycle state surfaced to the desktop shell (window overlay + tray). */
export type DaemonStatus = "ready" | "restarting" | "failed";

export interface DaemonStatusInfo {
  error?: string;
  attempt?: number;
}

export type DaemonStatusListener = (
  status: DaemonStatus,
  info?: DaemonStatusInfo,
) => void;

export interface ManagedDaemon {
  url: string;
  owned: boolean;
  mode: DaemonMode;
  token?: string;
  shareUrl?: string;
  mobileSetupUrl?: string;
  secureShareUrl?: string;
  caCertUrl?: string;
  /** Current lifecycle status. */
  getStatus: () => DaemonStatus;
  /** Subscribe to lifecycle transitions. Returns an unsubscribe function. */
  onStatusChange: (listener: DaemonStatusListener) => () => void;
  /** Manually restart an owned daemon (no-op for existing/remote daemons). */
  restart: () => Promise<void>;
  stop: () => Promise<void>;
}

export interface EnsureDaemonOptions {
  webDistPath?: string;
  mode?: DaemonMode;
  remoteUrl?: string;
  token?: string;
  host?: string;
  port?: number;
  httpsPort?: number;
  allowRemote?: boolean;
  mobileHttps?: boolean;
}

export interface DaemonPaths {
  home: string;
  daemonPath: string;
  localTokenPath: string;
}

export interface HealthyDaemon {
  daemon: DaemonFile;
  url: string;
  token: string;
}

export interface ShareUrls {
  shareUrl?: string;
  mobileSetupUrl?: string;
  secureShareUrl?: string;
  caCertUrl?: string;
}

export interface ChildExit {
  code: number | null;
  signal: string | null;
}
