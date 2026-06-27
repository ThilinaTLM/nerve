import { type ChildProcess, spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";
import type { DaemonCrashReportKind } from "@nervekit/shared";
import { serializeCrashError, writeCrashReportSync } from "./crash-reports.js";
import {
  assertHealthy,
  buildOrchestratorEnv,
  buildShareUrls,
  type DaemonPaths,
  findHealthyDaemon,
  type HealthyDaemon,
  isHealthy,
  isLoopbackHost,
  normalizeRemoteDaemonUrl,
  resolveDaemonPaths,
  resolveOrchestratorMainPath,
  resolveReadinessTimeoutMs,
  type ShareUrls,
  wantsLanAccess,
} from "./daemon-helpers.js";
import { desktopLog } from "./logging.js";

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

interface ChildExit {
  code: number | null;
  signal: NodeJS.Signals | null;
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
      `Nerve orchestrator build was not found at ${orchestratorMain}. Run pnpm --filter @nervekit/orchestrator build first.`,
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
  private childStartedAt?: number;
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

  private writeOwnedCrashReport(
    kind: DaemonCrashReportKind,
    message: string,
    details: {
      exit?: ChildExit;
      error?: unknown;
      output?: OutputBuffer;
      context?: Record<string, unknown>;
    } = {},
  ): string | undefined {
    const paths = this.config.paths;
    if (!paths) return undefined;
    return writeCrashReportSync(paths.home, {
      source: "desktop",
      kind,
      message,
      pid: this.child?.pid,
      exitCode: details.exit?.code,
      signal: details.exit?.signal,
      uptimeMs: this.childStartedAt
        ? Math.max(0, Date.now() - this.childStartedAt)
        : undefined,
      outputTail: details.output?.tail() ?? this.childOutput?.tail(),
      error: details.error ? serializeCrashError(details.error) : undefined,
      context: details.context,
    });
  }

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
    this.childStartedAt = Date.now();

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
        const crashReportPath = this.writeOwnedCrashReport(
          "startupError",
          `Failed to start the Nerve daemon: ${spawnError.message}`,
          {
            error: spawnError,
            output,
            context: { orchestratorMain, readinessTimeoutMs },
          },
        );
        throw daemonStartupError(
          `Failed to start the Nerve daemon: ${spawnError.message}`,
          output,
          { dataDir: paths.home, readinessTimeoutMs, crashReportPath },
        );
      }
      if (childExit) {
        const message = `Nerve daemon exited before it became ready${formatExit(childExit)}.`;
        const crashReportPath = this.writeOwnedCrashReport(
          "startupExit",
          message,
          {
            exit: childExit,
            output,
            context: { orchestratorMain, readinessTimeoutMs },
          },
        );
        throw daemonStartupError(message, output, {
          dataDir: paths.home,
          readinessTimeoutMs,
          crashReportPath,
        });
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
    const crashReportPath = this.writeOwnedCrashReport(
      "startupTimeout",
      `Nerve daemon did not become ready within ${readinessTimeoutMs}ms.`,
      {
        output,
        context: { orchestratorMain, readinessTimeoutMs },
      },
    );
    const error = daemonStartupError(
      `Nerve daemon did not become ready within ${readinessTimeoutMs}ms.`,
      output,
      { dataDir: paths.home, readinessTimeoutMs, crashReportPath },
    );
    void desktopLog("error", "daemon", "Owned local daemon startup timed out", {
      error,
      context: {
        output: output.tail(),
        dataDir: paths.home,
        readinessTimeoutMs,
        crashReportPath,
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
      const output = this.childOutput?.tail() ?? "(no output)";
      const crashReportPath = this.writeOwnedCrashReport(
        "childExit",
        `Daemon process exited${formatExit({ code, signal })}.`,
        { exit: { code, signal } },
      );
      void desktopLog("warn", "daemon", "Owned daemon child exited", {
        context: {
          code,
          signal,
          output,
          crashReportPath,
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
  context?: {
    dataDir?: string;
    readinessTimeoutMs?: number;
    crashReportPath?: string;
  },
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
    context?.crashReportPath
      ? `Crash report: ${context.crashReportPath}`
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
