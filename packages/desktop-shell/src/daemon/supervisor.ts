import type { DaemonCrashReportKind } from "@nervekit/contracts";
import { daemonStartupError, formatExit, OutputBuffer } from "./diagnostics.js";
import {
  DAEMON_HEALTH_POLL_INTERVAL_MS,
  DAEMON_MAX_RESTART_ATTEMPTS,
  DAEMON_READY_POLL_INTERVAL_MS,
  DAEMON_SHUTDOWN_TIMEOUT_MS,
  DAEMON_UNHEALTHY_THRESHOLD,
  restartBackoffMs,
  shouldResetRestartBudget,
} from "./policy.js";
import type { DaemonChildHandle, DaemonRuntimePorts } from "./ports.js";
import type {
  ChildExit,
  DaemonMode,
  DaemonPaths,
  DaemonStatus,
  DaemonStatusInfo,
  DaemonStatusListener,
  HealthyDaemon,
  ManagedDaemon,
  ShareUrls,
} from "./types.js";
import { buildShareUrls } from "./urls.js";

export interface DaemonSupervisorConfig {
  mode: DaemonMode;
  owned: boolean;
  readinessTimeoutMs: number;
  paths?: DaemonPaths;
  serverMain?: string;
  launchEnv?: NodeJS.ProcessEnv;
}

interface OwnedChild {
  handle: DaemonChildHandle;
  output: OutputBuffer;
  startedAt: number;
  exited: boolean;
  exit?: ChildExit;
  spawnError?: Error;
  /** Post-ready crash monitoring reacts to exits only when set. */
  monitored: boolean;
  /** Superseded/stopped children are ignored by the exit handler. */
  detached: boolean;
  removeParentExitHook?: () => void;
  exitWaiters: Array<() => void>;
}

/**
 * Platform-neutral daemon supervision state machine.
 *
 * For owned local daemons it launches the workbench-server child through the
 * injected launcher, watches for crashes and unhealthy states, and restarts
 * with exponential backoff. For existing local daemons and remote daemons it
 * only health-monitors and reports `restarting`/`ready` transitions so the
 * desktop window overlay and tray stay accurate — it never launches or
 * terminates a process it does not own. `stop()` is terminal and idempotent.
 */
export class DaemonSupervisor {
  private status: DaemonStatus = "ready";
  private readonly listeners = new Set<DaemonStatusListener>();

  private child?: OwnedChild;

  private cancelHealthTimer?: () => void;
  private consecutiveFailures = 0;
  private restartAttempts = 0;
  private lastHealthyAt: number;
  private restarting = false;
  private stopped = false;
  private restartChain: Promise<void> = Promise.resolve();

  private url = "";
  private token?: string;
  private shareUrls: ShareUrls = {};

  constructor(
    private readonly config: DaemonSupervisorConfig,
    private readonly ports: DaemonRuntimePorts,
  ) {
    this.lastHealthyAt = ports.scheduler.now();
  }

  /** Launch the owned workbench-server child, wait until healthy, then monitor. */
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
        this.ports.logger.log("warn", "Daemon status listener failed", {
          error,
        });
      }
    }
  }

  private applyHealthy(healthy: HealthyDaemon): void {
    this.url = healthy.url;
    this.token = healthy.token;
    this.shareUrls = buildShareUrls(
      healthy.daemon,
      healthy.token,
      this.ports.networkInterfaces(),
    );
    this.lastHealthyAt = this.ports.scheduler.now();
    this.consecutiveFailures = 0;
  }

  private toManagedDaemon(): ManagedDaemon {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- Returned getters need the supervisor instance rather than the managed-daemon receiver.
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
      child?: OwnedChild;
      exit?: ChildExit;
      error?: unknown;
      context?: Record<string, unknown>;
    } = {},
  ): string | undefined {
    const paths = this.config.paths;
    if (!paths) return undefined;
    const child = details.child ?? this.child;
    return this.ports.crashReporter.write(paths.home, {
      kind,
      message,
      pid: child?.handle.pid,
      exitCode: details.exit?.code,
      signal: details.exit?.signal,
      uptimeMs: child
        ? Math.max(0, this.ports.scheduler.now() - child.startedAt)
        : undefined,
      outputTail: child?.output.tail(),
      error: details.error,
      context: details.context,
    });
  }

  private async spawnAndWait(): Promise<HealthyDaemon> {
    const { paths, serverMain, launchEnv, readinessTimeoutMs } =
      this.requireOwnedConfig();
    const output = new OutputBuffer();
    this.ports.logger.log("info", "Starting owned local daemon", {
      context: { serverMain, dataDir: paths.home, readinessTimeoutMs },
    });
    const child: OwnedChild = {
      handle: undefined as unknown as DaemonChildHandle,
      output,
      startedAt: this.ports.scheduler.now(),
      exited: false,
      monitored: false,
      detached: false,
      exitWaiters: [],
    };
    child.handle = this.ports.launcher.launch({
      serverMain,
      env: launchEnv,
      onOutput: (stream, chunk) => output.append(stream, chunk),
      onError: (error) => {
        child.spawnError = error;
      },
      onExit: (exit) => this.handleChildExit(child, exit),
    });
    child.removeParentExitHook = this.ports.parentExit.onParentExit(() => {
      if (!child.exited) child.handle.kill("SIGTERM");
    });
    this.child = child;

    const deadline = this.ports.scheduler.now() + readinessTimeoutMs;
    while (this.ports.scheduler.now() < deadline) {
      if (child.spawnError) {
        const crashReportPath = this.writeOwnedCrashReport(
          "startupError",
          `Failed to start the Nerve daemon: ${child.spawnError.message}`,
          {
            child,
            error: child.spawnError,
            context: { serverMain, readinessTimeoutMs },
          },
        );
        throw daemonStartupError(
          `Failed to start the Nerve daemon: ${child.spawnError.message}`,
          output,
          { dataDir: paths.home, readinessTimeoutMs, crashReportPath },
        );
      }
      if (child.exit) {
        const message = `Nerve daemon exited before it became ready${formatExit(child.exit)}.`;
        const crashReportPath = this.writeOwnedCrashReport(
          "startupExit",
          message,
          {
            child,
            exit: child.exit,
            context: { serverMain, readinessTimeoutMs },
          },
        );
        throw daemonStartupError(message, output, {
          dataDir: paths.home,
          readinessTimeoutMs,
          crashReportPath,
        });
      }
      const daemon = await this.ports.discovery.findHealthyDaemon(paths);
      if (daemon) {
        this.ports.logger.log("info", "Owned local daemon became ready", {
          context: { url: daemon.url },
        });
        return daemon;
      }
      await this.ports.scheduler.delay(DAEMON_READY_POLL_INTERVAL_MS);
    }

    await this.stopOwnedChild(child);
    const crashReportPath = this.writeOwnedCrashReport(
      "startupTimeout",
      `Nerve daemon did not become ready within ${readinessTimeoutMs}ms.`,
      { child, context: { serverMain, readinessTimeoutMs } },
    );
    const error = daemonStartupError(
      `Nerve daemon did not become ready within ${readinessTimeoutMs}ms.`,
      output,
      { dataDir: paths.home, readinessTimeoutMs, crashReportPath },
    );
    this.ports.logger.log("error", "Owned local daemon startup timed out", {
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

  private handleChildExit(child: OwnedChild, exit: ChildExit): void {
    child.exited = true;
    child.exit = exit;
    for (const waiter of child.exitWaiters.splice(0)) waiter();
    if (!child.monitored || child.detached || this.stopped) return;
    const output = child.output.tail();
    const crashReportPath = this.writeOwnedCrashReport(
      "childExit",
      `Daemon process exited${formatExit(exit)}.`,
      { child, exit },
    );
    this.ports.logger.log("warn", "Owned daemon child exited", {
      context: {
        code: exit.code,
        signal: exit.signal,
        output,
        crashReportPath,
      },
    });
    void this.scheduleRestart(`Daemon process exited${formatExit(exit)}.`);
  }

  private attachChildMonitor(): void {
    if (this.child) this.child.monitored = true;
  }

  // --- health monitoring ---

  private startHealthMonitor(): void {
    this.stopHealthMonitor();
    this.cancelHealthTimer = this.ports.scheduler.every(
      DAEMON_HEALTH_POLL_INTERVAL_MS,
      () => void this.runHealthCheck(),
    );
  }

  private stopHealthMonitor(): void {
    this.cancelHealthTimer?.();
    this.cancelHealthTimer = undefined;
  }

  private async runHealthCheck(): Promise<void> {
    if (this.stopped || this.restarting) return;
    if (!this.url || !this.token) return;
    const healthy = await this.ports.health.isHealthy(this.url, this.token);
    if (healthy) {
      this.consecutiveFailures = 0;
      this.lastHealthyAt = this.ports.scheduler.now();
      // Sustained health resets the restart budget.
      this.restartAttempts = 0;
      if (this.status !== "ready") this.setStatus("ready");
      return;
    }
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures < DAEMON_UNHEALTHY_THRESHOLD) return;
    if (this.config.owned && this.child?.exited) return; // child-exit path handles it
    void this.scheduleRestart(
      `Daemon stopped responding after ${this.consecutiveFailures} failed health checks.`,
    );
  }

  // --- restart orchestration ---

  private requestManualRestart(): Promise<void> {
    if (!this.config.owned) {
      this.ports.logger.log(
        "info",
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
    if (
      this.status === "ready" &&
      this.child &&
      !this.child.exited &&
      !manual
    ) {
      // Already recovered by a previous chained restart.
      const healthy =
        this.url && this.token
          ? await this.ports.health.isHealthy(this.url, this.token)
          : false;
      if (healthy) return;
    }
    this.restarting = true;
    if (
      shouldResetRestartBudget(this.lastHealthyAt, this.ports.scheduler.now())
    ) {
      this.restartAttempts = 0;
    }

    // Clean up the previous child before relaunching.
    const previous = this.child;
    if (previous) {
      previous.detached = true;
      previous.removeParentExitHook?.();
      previous.removeParentExitHook = undefined;
      if (!previous.exited) {
        await this.stopOwnedChild(previous).catch(() => undefined);
      }
      this.child = undefined;
    }

    while (
      !this.stopped &&
      this.restartAttempts < DAEMON_MAX_RESTART_ATTEMPTS
    ) {
      const attempt = this.restartAttempts + 1;
      this.setStatus("restarting", { error: reason, attempt });
      const backoff = restartBackoffMs(attempt);
      this.ports.logger.log("info", "Restarting owned daemon", {
        context: { attempt, backoffMs: backoff, reason },
      });
      await this.ports.scheduler.delay(backoff);
      if (this.stopped) break;
      this.restartAttempts = attempt;
      try {
        const healthy = await this.spawnAndWait();
        this.applyHealthy(healthy);
        this.attachChildMonitor();
        this.restarting = false;
        this.restartAttempts = 0;
        this.consecutiveFailures = 0;
        this.ports.logger.log("info", "Owned daemon restarted", {
          context: { url: healthy.url, attempt },
        });
        this.setStatus("ready");
        return;
      } catch (error) {
        this.ports.logger.log("error", "Daemon restart attempt failed", {
          error,
          context: { attempt },
        });
      }
    }

    this.restarting = false;
    if (this.stopped) return;
    this.ports.logger.log("error", "Daemon restart gave up", {
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
    const child = this.child;
    if (child) {
      child.detached = true;
      child.removeParentExitHook?.();
      child.removeParentExitHook = undefined;
    }
    if (!this.config.owned) return;
    if (!child) return;
    await this.stopOwnedChild(child);
  }

  private async stopOwnedChild(child: OwnedChild): Promise<void> {
    if (child.exited) {
      this.ports.logger.log("info", "Owned child already exited before stop");
      return;
    }

    const startedAt = this.ports.scheduler.now();
    let forced = false;
    let fallbackResolved = false;
    const exitPromise = new Promise<void>((resolve) =>
      child.exitWaiters.push(resolve),
    );
    if (child.handle.kill("SIGTERM")) {
      const graceful = await Promise.race([
        exitPromise.then(() => true),
        this.ports.scheduler
          .delay(DAEMON_SHUTDOWN_TIMEOUT_MS)
          .then(() => false),
      ]);
      if (!graceful && !child.exited) {
        forced = true;
        child.handle.kill("SIGKILL");
        const killed = await Promise.race([
          exitPromise.then(() => true),
          this.ports.scheduler.delay(1000).then(() => false),
        ]);
        fallbackResolved = !killed;
      }
    }
    this.ports.logger.log("info", "Owned child stop completed", {
      context: {
        durationMs: this.ports.scheduler.now() - startedAt,
        forced,
        fallbackResolved,
        exited: child.exited,
      },
    });
  }

  private requireOwnedConfig(): {
    paths: DaemonPaths;
    serverMain: string;
    launchEnv: NodeJS.ProcessEnv;
    readinessTimeoutMs: number;
  } {
    if (
      !this.config.paths ||
      !this.config.serverMain ||
      !this.config.launchEnv
    ) {
      throw new Error(
        "Owned daemon supervisor is missing spawn configuration.",
      );
    }
    return {
      paths: this.config.paths,
      serverMain: this.config.serverMain,
      launchEnv: this.config.launchEnv,
      readinessTimeoutMs: this.config.readinessTimeoutMs,
    };
  }
}
