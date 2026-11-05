import type {
  DaemonFile,
  ServerLifecycleState,
} from "@nervekit/contracts/status";

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
  /**
   * Live bearer for API calls: the daemon token for a local daemon, the device
   * credential for a remote one. Rotation updates it in place, so read it at
   * request time instead of caching it.
   */
  token?: string;
  /** Credential-free LAN URL of the local CA certificate (mobile HTTPS only). */
  caCertUrl?: string;
  /** Mobile pairing links can be minted (LAN-bound daemon with mobile HTTPS). */
  mobileShareAvailable: boolean;
  /**
   * Mints a single-use pairing code and returns the links that carry it in the
   * URL fragment. Called lazily on user action; never embeds a long-lived token.
   */
  createShareUrls: () => Promise<ShareUrls>;
  /** Re-reads the credential after the daemon rejected it; true when it changed. */
  refreshCredential: () => Promise<boolean>;
  /** Adopts a credential the daemon rotated (`x-nerve-credential`). */
  acceptRotatedCredential: (credential: string) => void;
  /** Fires after `token` changed (rotation, re-read after a local token rotation). */
  onCredentialChange: (listener: () => void) => () => void;
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
  /** One-time pairing code to redeem for a remote device credential. */
  pairCode?: string;
  /**
   * Deprecated: a remote daemon token, accepted for one release and only used
   * to bootstrap a device credential.
   */
  token?: string;
  host?: string;
  port?: number;
  httpsPort?: number;
  allowRemote?: boolean;
  mobileHttps?: boolean;
  startupTimeoutMs?: number;
  maxOldSpaceMb?: number;
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
  lifecycle?: ServerLifecycleState;
}

/** Links that carry a single-use pairing code in the fragment. */
export interface ShareUrls {
  /** `http://<lan>:<port>/mobile-setup#pair=CODE` (CA install, then secure link). */
  mobileSetupUrl: string;
  /** `https://<host>/#pair=CODE`. */
  secureShareUrl: string;
}

export interface ChildExit {
  code: number | null;
  signal: string | null;
}
