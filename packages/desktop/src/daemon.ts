import { type ChildProcess, spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { homedir, networkInterfaces } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type DaemonFile, daemonFileSchema } from "@nerve/shared";
import { desktopLog } from "./logging.js";

const defaultReadinessTimeoutMs = 60_000;
const healthCheckTimeoutMs = 1500;
const shutdownTimeoutMs = 5000;
const healthPollIntervalMs = 5000;
const unhealthyThreshold = 3;
const restartBackoffMs = [500, 1000, 2000, 5000, 10_000];
const maxRestartAttempts = 5;
const healthyResetMs = 60_000;

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

interface DaemonPaths {
  home: string;
  daemonPath: string;
  localTokenPath: string;
}

interface ChildExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

interface HealthyDaemon {
  daemon: DaemonFile;
  url: string;
  token: string;
}

interface ShareUrls {
  shareUrl?: string;
  mobileSetupUrl?: string;
  secureShareUrl?: string;
  caCertUrl?: string;
}

class OutputBuffer {
  private readonly lines: string[] = [];

  append(stream: "stdout" | "stderr", chunk: unknown): void {
    const text = Buffer.isBuffer(chunk)
      ? chunk.toString("utf8")
      : String(chunk);
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      this.lines.push(`[${stream}] ${line}`);
    }
    if (this.lines.length > 200) this.lines.splice(0, this.lines.length - 200);
  }

  tail(): string {
    return this.lines.length > 0 ? this.lines.join("\n") : "(no output)";
  }
}

export async function ensureDaemon(
  options: EnsureDaemonOptions = {},
): Promise<ManagedDaemon> {
  if (options.mode === "remote" || options.remoteUrl) {
    void desktopLog("info", "daemon", "Connecting to remote daemon", {
      context: { url: options.remoteUrl },
    });
    return connectRemoteDaemon(options);
  }
  void desktopLog("info", "daemon", "Ensuring local daemon");
  return ensureLocalDaemon(options);
}

async function connectRemoteDaemon(
  options: EnsureDaemonOptions,
): Promise<ManagedDaemon> {
  if (!options.remoteUrl) {
    throw new Error("Missing remote daemon URL. Use --connect <url>.");
  }
  const url = normalizeRemoteDaemonUrl(options.remoteUrl);
  const token = options.token?.trim() || process.env.NERVE_DAEMON_TOKEN?.trim();
  if (!token) {
    throw new Error(
      "Missing remote daemon token. Use --token <token> or NERVE_DAEMON_TOKEN.",
    );
  }

  await assertHealthy(url, token, "remote Nerve daemon");
  const supervisor = new DaemonSupervisor({
    mode: "remote",
    owned: false,
    options,
    readinessTimeoutMs: resolveReadinessTimeoutMs(),
  });
  return supervisor.initMonitorOnly({ url, token });
}

async function ensureLocalDaemon(
  options: EnsureDaemonOptions,
): Promise<ManagedDaemon> {
  const paths = resolveDaemonPaths();
  const readinessTimeoutMs = resolveReadinessTimeoutMs();
  const existing = await findHealthyDaemon(paths);
  if (existing) {
    if (wantsLanAccess(options) && isLoopbackHost(existing.daemon.host)) {
      throw new Error(
        `A Nerve daemon is already running at ${existing.url}, but it is bound to ${existing.daemon.host} and cannot accept LAN clients. Stop the existing daemon, then run pnpm desktop again.`,
      );
    }
    if (options.mobileHttps && !existing.daemon.mobileHttps) {
      throw new Error(
        `A Nerve daemon is already running at ${existing.url}, but mobile HTTPS is not enabled. Stop the existing daemon, then run with --mobile-https again.`,
      );
    }
    void desktopLog("info", "daemon", "Using existing healthy local daemon", {
      context: { url: existing.url },
    });
    const supervisor = new DaemonSupervisor({
      mode: "local",
      owned: false,
      options,
      paths,
      readinessTimeoutMs,
    });
    return supervisor.initMonitorOnly(existing);
  }

  const orchestratorMain = resolveOrchestratorMainPath();
  await access(orchestratorMain).catch(() => {
    throw new Error(
      `Nerve orchestrator build was not found at ${orchestratorMain}. Run pnpm --filter @nerve/orchestrator build first.`,
    );
  });

  const supervisor = new DaemonSupervisor({
    mode: "local",
    owned: true,
    options,
    paths,
    orchestratorMain,
    readinessTimeoutMs,
  });
  return supervisor.startOwned();
}

interface SupervisorConfig {
  mode: DaemonMode;
  owned: boolean;
  options: EnsureDaemonOptions;
  readinessTimeoutMs: number;
  paths?: DaemonPaths;
  orchestratorMain?: string;
}

/**
 * Supervises the lifecycle of the connected daemon.
 *
 * For owned local daemons it spawns the orchestrator child, watches for crashes
 * and unhealthy states, and restarts with exponential backoff. For existing
 * local daemons and remote daemons it only health-monitors and reports
 * `restarting`/`ready` transitions so the desktop window overlay and tray stay
 * accurate (it never spawns a child it does not own).
 */
class DaemonSupervisor {
  private status: DaemonStatus = "ready";
  private readonly listeners = new Set<DaemonStatusListener>();

  private child?: ChildProcess;
  private childExited = false;
  private childOutput?: OutputBuffer;
  private detachChildExit?: () => void;
  private removeParentExitHook?: () => void;

  private healthTimer?: ReturnType<typeof setInterval>;
  private consecutiveFailures = 0;
  private restartAttempts = 0;
  private lastHealthyAt = Date.now();
  private restarting = false;
  private stopped = false;
  private restartChain: Promise<void> = Promise.resolve();

  private url = "";
  private token?: string;
  private shareUrls: ShareUrls = {};

  constructor(private readonly config: SupervisorConfig) {}

  /** Spawn the owned orchestrator child, wait until healthy, then monitor. */
  async startOwned(): Promise<ManagedDaemon> {
    const healthy = await this.spawnAndWait();
    this.applyHealthy(healthy);
    this.attachChildMonitor();
    this.startHealthMonitor();
    return this.toManagedDaemon();
  }

  /** Attach monitoring to an already-running (existing/remote) daemon. */
  initMonitorOnly(connection: { url: string; token: string }): ManagedDaemon {
    this.url = connection.url;
    this.token = connection.token;
    this.startHealthMonitor();
    return this.toManagedDaemon();
  }

  getStatus(): DaemonStatus {
    return this.status;
  }

  onStatusChange(listener: DaemonStatusListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setStatus(status: DaemonStatus, info?: DaemonStatusInfo): void {
    if (this.status === status && status !== "restarting") return;
    this.status = status;
    for (const listener of this.listeners) {
      try {
        listener(status, info);
      } catch (error) {
        void desktopLog("warn", "daemon", "Daemon status listener failed", {
          error,
        });
      }
    }
  }

  private applyHealthy(healthy: HealthyDaemon): void {
    this.url = healthy.url;
    this.token = healthy.token;
    this.shareUrls = buildShareUrls(healthy.daemon, healthy.token);
    this.lastHealthyAt = Date.now();
    this.consecutiveFailures = 0;
  }

  private toManagedDaemon(): ManagedDaemon {
    const supervisor = this;
    return {
      get url() {
        return supervisor.url;
      },
      get token() {
        return supervisor.token;
      },
      get shareUrl() {
        return supervisor.shareUrls.shareUrl;
      },
      get mobileSetupUrl() {
        return supervisor.shareUrls.mobileSetupUrl;
      },
      get secureShareUrl() {
        return supervisor.shareUrls.secureShareUrl;
      },
      get caCertUrl() {
        return supervisor.shareUrls.caCertUrl;
      },
      owned: supervisor.config.owned,
      mode: supervisor.config.mode,
      getStatus: () => supervisor.getStatus(),
      onStatusChange: (listener) => supervisor.onStatusChange(listener),
      restart: () => supervisor.requestManualRestart(),
      stop: () => supervisor.stop(),
    };
  }

  // --- owned-child spawn / readiness ---

  private async spawnAndWait(): Promise<HealthyDaemon> {
    const { paths, orchestratorMain, options, readinessTimeoutMs } =
      this.requireOwnedConfig();
    const output = new OutputBuffer();
    this.childOutput = output;
    void desktopLog("info", "daemon", "Starting owned local daemon", {
      context: {
        orchestratorMain,
        dataDir: paths.home,
        readinessTimeoutMs,
      },
    });
    const child = spawn(process.execPath, [orchestratorMain], {
      env: buildOrchestratorEnv(options),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;
    this.childExited = false;

    child.stdout?.on("data", (chunk) => output.append("stdout", chunk));
    child.stderr?.on("data", (chunk) => output.append("stderr", chunk));

    let spawnError: Error | undefined;
    let childExit: ChildExit | undefined;
    const killOnParentExit = () => {
      if (!childExit) child.kill("SIGTERM");
    };
    process.once("exit", killOnParentExit);
    this.removeParentExitHook = () => process.off("exit", killOnParentExit);
    child.once("error", (error) => {
      spawnError = error;
    });
    child.once("exit", (code, signal) => {
      childExit = { code, signal };
      this.childExited = true;
    });

    const deadline = Date.now() + readinessTimeoutMs;
    while (Date.now() < deadline) {
      if (spawnError) {
        throw daemonStartupError(
          `Failed to start the Nerve daemon: ${spawnError.message}`,
          output,
          { dataDir: paths.home, readinessTimeoutMs },
        );
      }
      if (childExit) {
        throw daemonStartupError(
          `Nerve daemon exited before it became ready${formatExit(childExit)}.`,
          output,
          { dataDir: paths.home, readinessTimeoutMs },
        );
      }
      const daemon = await findHealthyDaemon(paths);
      if (daemon) {
        void desktopLog("info", "daemon", "Owned local daemon became ready", {
          context: { url: daemon.url },
        });
        return daemon;
      }
      await delay(200);
    }

    await stopOwnedChild(child, () => this.childExited);
    const error = daemonStartupError(
      `Nerve daemon did not become ready within ${readinessTimeoutMs}ms.`,
      output,
      { dataDir: paths.home, readinessTimeoutMs },
    );
    void desktopLog("error", "daemon", "Owned local daemon startup timed out", {
      error,
      context: {
        output: output.tail(),
        dataDir: paths.home,
        readinessTimeoutMs,
      },
    });
    throw error;
  }

  private attachChildMonitor(): void {
    const child = this.child;
    if (!child) return;
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      this.childExited = true;
      if (this.stopped) return;
      void desktopLog("warn", "daemon", "Owned daemon child exited", {
        context: {
          code,
          signal,
          output: this.childOutput?.tail() ?? "(no output)",
        },
      });
      this.scheduleRestart(
        `Daemon process exited${formatExit({ code, signal })}.`,
      );
    };
    child.on("exit", onExit);
    this.detachChildExit = () => child.off("exit", onExit);
  }

  // --- health monitoring ---

  private startHealthMonitor(): void {
    this.stopHealthMonitor();
    this.healthTimer = setInterval(() => {
      void this.runHealthCheck();
    }, healthPollIntervalMs);
    this.healthTimer.unref?.();
  }

  private stopHealthMonitor(): void {
    if (!this.healthTimer) return;
    clearInterval(this.healthTimer);
    this.healthTimer = undefined;
  }

  private async runHealthCheck(): Promise<void> {
    if (this.stopped || this.restarting) return;
    if (!this.url || !this.token) return;
    const healthy = await isHealthy(this.url, this.token);
    if (healthy) {
      this.consecutiveFailures = 0;
      this.lastHealthyAt = Date.now();
      // Sustained health resets the restart budget.
      this.restartAttempts = 0;
      if (this.status !== "ready") this.setStatus("ready");
      return;
    }
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures < unhealthyThreshold) return;
    if (this.config.owned && this.childExited) return; // child-exit path handles it
    this.scheduleRestart(
      `Daemon stopped responding after ${this.consecutiveFailures} failed health checks.`,
    );
  }

  // --- restart orchestration ---

  private requestManualRestart(): Promise<void> {
    if (!this.config.owned) {
      void desktopLog(
        "info",
        "daemon",
        "Manual restart ignored for non-owned daemon",
      );
      return Promise.resolve();
    }
    this.restartAttempts = 0;
    return this.scheduleRestart("Manual restart requested.", true);
  }

  private scheduleRestart(reason: string, manual = false): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (!this.config.owned) {
      // Existing/remote: we cannot respawn; reflect waiting state and let the
      // health monitor flip back to ready when the daemon recovers.
      this.setStatus("restarting", { error: reason });
      return Promise.resolve();
    }
    this.restartChain = this.restartChain.then(() =>
      this.performRestart(reason, manual),
    );
    return this.restartChain;
  }

  private async performRestart(reason: string, manual: boolean): Promise<void> {
    if (this.stopped) return;
    if (this.status === "ready" && this.childExited === false && !manual) {
      // Already recovered by a previous chained restart.
      const healthy =
        this.url && this.token ? await isHealthy(this.url, this.token) : false;
      if (healthy) return;
    }
    this.restarting = true;
    if (Date.now() - this.lastHealthyAt > healthyResetMs) {
      this.restartAttempts = 0;
    }

    // Clean up the previous child before respawning.
    this.detachChildExit?.();
    this.detachChildExit = undefined;
    this.removeParentExitHook?.();
    this.removeParentExitHook = undefined;
    if (this.child && !this.childExited) {
      await stopOwnedChild(this.child, () => this.childExited).catch(
        () => undefined,
      );
    }
    this.child = undefined;

    while (!this.stopped && this.restartAttempts < maxRestartAttempts) {
      const attempt = this.restartAttempts + 1;
      this.setStatus("restarting", { error: reason, attempt });
      const backoff =
        restartBackoffMs[Math.min(attempt - 1, restartBackoffMs.length - 1)] ??
        10_000;
      void desktopLog("info", "daemon", "Restarting owned daemon", {
        context: { attempt, backoffMs: backoff, reason },
      });
      await delay(backoff);
      if (this.stopped) break;
      this.restartAttempts = attempt;
      try {
        const healthy = await this.spawnAndWait();
        this.applyHealthy(healthy);
        this.attachChildMonitor();
        this.restarting = false;
        this.restartAttempts = 0;
        this.consecutiveFailures = 0;
        void desktopLog("info", "daemon", "Owned daemon restarted", {
          context: { url: healthy.url, attempt },
        });
        this.setStatus("ready");
        return;
      } catch (error) {
        void desktopLog("error", "daemon", "Daemon restart attempt failed", {
          error,
          context: { attempt },
        });
      }
    }

    this.restarting = false;
    if (this.stopped) return;
    void desktopLog("error", "daemon", "Daemon restart gave up", {
      context: { attempts: this.restartAttempts },
    });
    this.setStatus("failed", {
      error: `Could not restart the Nerve daemon after ${this.restartAttempts} attempts. ${reason}`,
    });
  }

  // --- teardown ---

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.stopHealthMonitor();
    this.detachChildExit?.();
    this.detachChildExit = undefined;
    this.removeParentExitHook?.();
    this.removeParentExitHook = undefined;
    if (!this.config.owned) return;
    if (!this.child) return;
    await stopOwnedChild(this.child, () => this.childExited);
  }

  private requireOwnedConfig(): {
    paths: DaemonPaths;
    orchestratorMain: string;
    options: EnsureDaemonOptions;
    readinessTimeoutMs: number;
  } {
    if (!this.config.paths || !this.config.orchestratorMain) {
      throw new Error(
        "Owned daemon supervisor is missing spawn configuration.",
      );
    }
    return {
      paths: this.config.paths,
      orchestratorMain: this.config.orchestratorMain,
      options: this.config.options,
      readinessTimeoutMs: this.config.readinessTimeoutMs,
    };
  }
}

function resolveDaemonMaxOldSpaceMb(): number {
  const raw = process.env.NERVE_DAEMON_MAX_OLD_SPACE_MB?.trim();
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 4096;
}

function buildOrchestratorEnv(options: EnsureDaemonOptions): NodeJS.ProcessEnv {
  const nodeOptions = [
    process.env.NODE_OPTIONS,
    `--max-old-space-size=${resolveDaemonMaxOldSpaceMb()}`,
  ]
    .filter(Boolean)
    .join(" ");
  return {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    NODE_OPTIONS: nodeOptions,
    NERVE_HOST: options.host ?? process.env.NERVE_HOST ?? "127.0.0.1",
    ...(options.port ? { NERVE_PORT: String(options.port) } : {}),
    ...(options.httpsPort
      ? { NERVE_HTTPS_PORT: String(options.httpsPort) }
      : {}),
    ...(options.allowRemote ? { NERVE_ALLOW_REMOTE: "1" } : {}),
    ...(options.mobileHttps ? { NERVE_MOBILE_HTTPS: "1" } : {}),
    ...(options.webDistPath ? { NERVE_WEB_DIST: options.webDistPath } : {}),
  };
}

function buildShareUrls(daemon: DaemonFile, token: string): ShareUrls {
  const shareUrl = remoteShareUrl(daemon, token);
  const secureUrls = remoteSecureUrls(daemon, token);
  return {
    shareUrl,
    mobileSetupUrl: secureUrls?.mobileSetupUrl,
    secureShareUrl: secureUrls?.secureShareUrl,
    caCertUrl: secureUrls?.caCertUrl,
  };
}

function wantsLanAccess(options: EnsureDaemonOptions): boolean {
  const host = options.host ?? process.env.NERVE_HOST;
  return Boolean(
    options.allowRemote ||
      process.env.NERVE_ALLOW_REMOTE === "1" ||
      (host && !isLoopbackHost(host)),
  );
}

function resolveDaemonPaths(): DaemonPaths {
  const explicitHome = process.env.NERVE_HOME;
  const home = explicitHome?.trim() ? explicitHome : join(homedir(), ".nerve");
  return {
    home,
    daemonPath: join(home, "daemon.json"),
    localTokenPath: join(home, "auth", "local-token"),
  };
}

function resolveReadinessTimeoutMs(): number {
  const raw = process.env.NERVE_DAEMON_STARTUP_TIMEOUT_MS?.trim();
  if (!raw) return defaultReadinessTimeoutMs;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return defaultReadinessTimeoutMs;
  return Math.max(1, Math.trunc(value));
}

function resolveOrchestratorMainPath(): string {
  const resolvedUrl = import.meta.resolve("@nerve/orchestrator/main");
  return fileURLToPath(resolvedUrl);
}

async function findHealthyDaemon(
  paths: DaemonPaths,
): Promise<HealthyDaemon | undefined> {
  const daemon = await readDaemonFile(paths.daemonPath);
  if (!daemon) return undefined;

  const url = localConnectUrl(daemon.url);
  if (!url) return undefined;

  const token = await readToken(paths.localTokenPath);
  if (!token) return undefined;

  const healthy = await isHealthy(url, token);
  return healthy ? { daemon, url, token } : undefined;
}

function remoteShareUrl(daemon: DaemonFile, token: string): string | undefined {
  const host = remoteShareHost(daemon.host);
  if (!host) return undefined;
  const url = new URL(`http://127.0.0.1:${daemon.port}/`);
  url.hostname = host;
  url.searchParams.set("token", token);
  return url.toString();
}

function remoteSecureUrls(
  daemon: DaemonFile,
  token: string,
):
  | { mobileSetupUrl: string; secureShareUrl: string; caCertUrl: string }
  | undefined {
  if (!daemon.mobileHttps) return undefined;
  const host = remoteShareHost(daemon.host);
  if (!host) return undefined;
  const secureShareUrl = new URL(
    `https://127.0.0.1:${daemon.mobileHttps.port}/`,
  );
  secureShareUrl.hostname = host;
  secureShareUrl.searchParams.set("token", token);

  const mobileSetupUrl = new URL(
    `http://127.0.0.1:${daemon.port}/mobile-setup`,
  );
  mobileSetupUrl.hostname = host;
  mobileSetupUrl.searchParams.set("token", token);

  const caCertUrl = new URL(
    `http://127.0.0.1:${daemon.port}/nerve-local-ca.pem`,
  );
  caCertUrl.hostname = host;

  return {
    mobileSetupUrl: mobileSetupUrl.toString(),
    secureShareUrl: secureShareUrl.toString(),
    caCertUrl: caCertUrl.toString(),
  };
}

function remoteShareHost(boundHost: string): string | undefined {
  if (isWildcardHost(boundHost)) return firstLanIpv4Address();
  if (isLoopbackHost(boundHost)) return undefined;
  if (boundHost.includes(":")) return undefined;
  return boundHost;
}

function firstLanIpv4Address(): string | undefined {
  const candidates: Array<{ name: string; address: string }> = [];
  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) {
        candidates.push({ name, address: address.address });
      }
    }
  }

  return (
    candidates.find(
      (candidate) =>
        isPrivateIpv4(candidate.address) && !isVirtualInterface(candidate.name),
    )?.address ??
    candidates.find((candidate) => isPrivateIpv4(candidate.address))?.address ??
    candidates.find((candidate) => !isVirtualInterface(candidate.name))
      ?.address ??
    candidates[0]?.address
  );
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return false;
  }
  const [first, second] = parts;
  return (
    first === 10 ||
    (first === 172 && second !== undefined && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function isVirtualInterface(name: string): boolean {
  return /^(br-|docker|veth|virbr|vmnet|vboxnet|lo)/i.test(name);
}

function isWildcardHost(host: string): boolean {
  return host === "0.0.0.0" || host === "::";
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized.startsWith("127.") ||
    normalized.startsWith("::ffff:127.")
  );
}

async function readDaemonFile(path: string): Promise<DaemonFile | undefined> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = daemonFileSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

async function readToken(path: string): Promise<string | undefined> {
  try {
    const token = (await readFile(path, "utf8")).trim();
    return token.length > 0 ? token : undefined;
  } catch {
    return undefined;
  }
}

async function assertHealthy(
  daemonUrl: string,
  token: string,
  label: string,
): Promise<void> {
  if (await isHealthy(daemonUrl, token)) return;
  throw new Error(`Could not connect to ${label} at ${daemonUrl}.`);
}

async function isHealthy(daemonUrl: string, token: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), healthCheckTimeoutMs);
  try {
    const response = await fetch(new URL("/api/status", daemonUrl), {
      headers: { authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeRemoteDaemonUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Remote daemon URL must use http:// or https://.");
  }
  return url.origin;
}

function localConnectUrl(rawUrl: string): string | undefined {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "http:") return undefined;
    if (url.hostname === "0.0.0.0" || url.hostname === "::") {
      url.hostname = "127.0.0.1";
    }
    return url.origin;
  } catch {
    return undefined;
  }
}

async function stopOwnedChild(
  child: ChildProcess,
  hasExited: () => boolean,
): Promise<void> {
  if (hasExited()) {
    void desktopLog("info", "daemon", "Owned child already exited before stop");
    return;
  }

  const startedAt = Date.now();
  let forced = false;
  let fallbackResolved = false;
  await new Promise<void>((resolveStop) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(forceTimer);
      clearTimeout(resolveTimer);
      resolveStop();
    };
    const forceTimer = setTimeout(() => {
      if (!hasExited()) {
        forced = true;
        child.kill("SIGKILL");
      }
    }, shutdownTimeoutMs);
    const resolveTimer = setTimeout(() => {
      fallbackResolved = true;
      finish();
    }, shutdownTimeoutMs + 1000);

    child.once("exit", finish);
    if (!child.kill("SIGTERM")) finish();
  });
  void desktopLog("info", "daemon", "Owned child stop completed", {
    durationMs: Date.now() - startedAt,
    context: { forced, fallbackResolved, exited: hasExited() },
  });
}

function daemonStartupError(
  message: string,
  output: OutputBuffer,
  context?: { dataDir?: string; readinessTimeoutMs?: number },
): Error {
  const diagnostics = [
    context?.readinessTimeoutMs
      ? `Startup timeout: ${context.readinessTimeoutMs}ms`
      : undefined,
    context?.dataDir ? `Data dir: ${context.dataDir}` : undefined,
    context?.dataDir
      ? `Application log: ${join(
          context.dataDir,
          "logs",
          `application-${new Date().toISOString().slice(0, 10)}.jsonl`,
        )}`
      : undefined,
  ].filter((line): line is string => Boolean(line));

  return new Error(
    `${message}\n\nDaemon output:\n${output.tail()}${
      diagnostics.length > 0
        ? `\n\nDiagnostics:\n${diagnostics.map((line) => `- ${line}`).join("\n")}`
        : ""
    }`,
  );
}

function formatExit(exit: ChildExit): string {
  if (exit.signal) return ` after signal ${exit.signal}`;
  if (exit.code !== null) return ` with code ${exit.code}`;
  return "";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
