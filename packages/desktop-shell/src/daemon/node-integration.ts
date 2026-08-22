import { spawn } from "node:child_process";
import { access, readFile, readdir, stat } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type DaemonFile, daemonFileSchema } from "@nervekit/contracts";
import { serializeCrashError, writeCrashReportSync } from "../crash-reports.js";
import { desktopLog } from "../logging.js";
import {
  DAEMON_DIAGNOSTIC_POLL_INTERVAL_MS,
  DAEMON_DIAGNOSTIC_TIMEOUT_MS,
} from "./policy.js";
import type {
  DaemonConnectionPorts,
  DaemonDiagnosticCaptureResult,
  DaemonHealthCheckResult,
} from "./ports.js";
import type { DaemonPaths, HealthyDaemon } from "./types.js";
import { localConnectUrl, type NetworkInterfacesSnapshot } from "./urls.js";

const HEALTH_CHECK_TIMEOUT_MS = 1500;
let daemonScopeCounter = 0;

export function resolveDaemonLaunch(input: {
  serverMain: string;
  args?: string[];
  env: NodeJS.ProcessEnv;
}): {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  systemdUnit?: string;
} {
  const daemonArgs = [input.serverMain, ...(input.args ?? [])];
  if (
    process.platform !== "linux" ||
    input.env.NERVE_ALLOW_UNCONTAINED_PROCESSES === "1" ||
    input.env.NERVE_CGROUP_ROOT
  ) {
    return { command: process.execPath, args: daemonArgs, env: input.env };
  }
  daemonScopeCounter += 1;
  const systemdUnit = `nerve-daemon-${process.pid}-${daemonScopeCounter}.scope`;
  return {
    command: "systemd-run",
    args: [
      "--user",
      "--scope",
      "--quiet",
      "--collect",
      `--unit=${systemdUnit}`,
      "--property=Delegate=yes",
      "--",
      process.execPath,
      ...daemonArgs,
    ],
    env: { ...input.env, NERVE_LINUX_DELEGATED_CGROUP: "1" },
    systemdUnit,
  };
}

export async function captureDiagnosticReport(
  child: ReturnType<typeof spawn>,
  dataDir: string,
): Promise<DaemonDiagnosticCaptureResult> {
  const startedAt = Date.now();
  if (process.platform === "win32") {
    return { outcome: "unsupported", elapsedMs: 0 };
  }
  const pid = child.pid;
  if (!pid) {
    return {
      outcome: "request_failed",
      elapsedMs: 0,
      error: "Daemon PID is unavailable",
    };
  }
  const directory = join(dataDir, "crashes");
  const before = new Set(await readdir(directory).catch(() => []));
  if (!child.kill("SIGUSR2")) {
    return {
      outcome: "request_failed",
      elapsedMs: Date.now() - startedAt,
      error: "SIGUSR2 could not be delivered",
    };
  }
  const pidMarker = `.${pid}.`;
  let candidate:
    | { path: string; size: number; mtimeMs: number; stable: number }
    | undefined;
  while (Date.now() - startedAt < DAEMON_DIAGNOSTIC_TIMEOUT_MS) {
    await new Promise((resolve) =>
      setTimeout(resolve, DAEMON_DIAGNOSTIC_POLL_INTERVAL_MS),
    );
    const names = await readdir(directory).catch(() => []);
    const name = names.find(
      (value) =>
        !before.has(value) &&
        value.startsWith("report.") &&
        value.includes(pidMarker) &&
        value.endsWith(".json"),
    );
    if (!name) continue;
    const path = join(directory, name);
    const info = await stat(path).catch(() => undefined);
    if (!info?.isFile()) continue;
    if (
      candidate?.path === path &&
      candidate.size === info.size &&
      candidate.mtimeMs === info.mtimeMs
    ) {
      candidate.stable += 1;
      if (candidate.stable >= 2) {
        return {
          outcome: "captured",
          elapsedMs: Date.now() - startedAt,
          path,
        };
      }
    } else {
      candidate = {
        path,
        size: info.size,
        mtimeMs: info.mtimeMs,
        stable: 0,
      };
    }
  }
  return { outcome: "timed_out", elapsedMs: Date.now() - startedAt };
}

/** Thin Node/Electron-shell adapters behind the daemon runtime ports. */
export function createNodeDaemonPorts(): DaemonConnectionPorts {
  return {
    env: process.env,
    health: { check: checkHealth },
    discovery: { findHealthyDaemon },
    launcher: {
      launch: (input) => {
        const launch = resolveDaemonLaunch(input);
        const child = spawn(launch.command, launch.args, {
          env: launch.env,
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        });
        child.stdout?.on("data", (chunk) => input.onOutput("stdout", chunk));
        child.stderr?.on("data", (chunk) => input.onOutput("stderr", chunk));
        child.once("error", (error) => input.onError(error));
        child.once("exit", (code, signal) => {
          if (launch.systemdUnit) {
            const cleanup = spawn(
              "systemctl",
              ["--user", "stop", launch.systemdUnit],
              { stdio: "ignore", windowsHide: true },
            );
            cleanup.unref();
          }
          input.onExit({ code, signal });
        });
        return {
          get pid() {
            return child.pid;
          },
          kill: (signal) => child.kill(signal),
          requestDiagnosticReport: (dataDir) =>
            captureDiagnosticReport(child, dataDir),
        };
      },
    },
    scheduler: {
      now: () => Date.now(),
      delay: (ms) =>
        new Promise((resolveDelay) => setTimeout(resolveDelay, ms)),
      every: (ms, callback) => {
        const timer = setInterval(callback, ms);
        timer.unref?.();
        return () => clearInterval(timer);
      },
    },
    parentExit: {
      onParentExit: (hook) => {
        process.once("exit", hook);
        return () => process.off("exit", hook);
      },
    },
    crashReporter: {
      write: (home, report) =>
        writeCrashReportSync(home, {
          source: "desktop",
          kind: report.kind,
          message: report.message,
          pid: report.pid,
          exitCode: report.exitCode,
          signal: report.signal,
          uptimeMs: report.uptimeMs,
          outputTail: report.outputTail,
          error:
            report.error === undefined
              ? undefined
              : serializeCrashError(report.error),
          context: report.context,
        }),
    },
    logger: {
      log: (level, message, data) =>
        void desktopLog(level, "daemon", message, data),
    },
    networkInterfaces: (): NetworkInterfacesSnapshot => networkInterfaces(),
    resolveServerMain: () =>
      fileURLToPath(import.meta.resolve("@nervekit/workbench-server/main")),
    fileExists: (path) =>
      access(path).then(
        () => true,
        () => false,
      ),
  };
}

export async function checkHealth(
  daemonUrl: string,
  token: string,
  options: {
    fetch?: typeof fetch;
    now?: () => number;
    timeoutMs?: number;
  } = {},
): Promise<DaemonHealthCheckResult> {
  const now = options.now ?? Date.now;
  const request = options.fetch ?? fetch;
  const startedAt = now();
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? HEALTH_CHECK_TIMEOUT_MS,
  );
  try {
    const response = await request(new URL("/api/health", daemonUrl), {
      headers: { authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    const durationMs = now() - startedAt;
    return response.ok
      ? { healthy: true, outcome: "ok", durationMs, status: response.status }
      : {
          healthy: false,
          outcome: "http_error",
          durationMs,
          status: response.status,
        };
  } catch (error) {
    return {
      healthy: false,
      outcome: controller.signal.aborted ? "timeout" : "network_error",
      durationMs: now() - startedAt,
      error: boundedHealthError(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function boundedHealthError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 512);
}

export async function findHealthyDaemon(
  paths: DaemonPaths,
): Promise<HealthyDaemon | undefined> {
  const daemonResult = await readDaemonFile(paths.daemonPath);
  if (daemonResult.status === "missing") return undefined;
  if (daemonResult.status !== "valid") {
    throw new Error(
      `Nerve daemon metadata at ${paths.daemonPath} is ${daemonResult.status}; refusing to start a second daemon.`,
      { cause: daemonResult.cause },
    );
  }
  const daemon = daemonResult.daemon;

  const url = localConnectUrl(daemon.url);
  if (!url) {
    throw new Error(
      `Nerve daemon metadata at ${paths.daemonPath} contains an invalid local URL; refusing to start a second daemon.`,
    );
  }

  const token = await readToken(paths.localTokenPath);

  const health = await checkHealth(url, token);
  return health.healthy ? { daemon, url, token } : undefined;
}

type DaemonMetadataRead =
  | { status: "missing" }
  | { status: "valid"; daemon: DaemonFile }
  | { status: "invalid" | "unreadable"; cause?: unknown };

async function readDaemonFile(path: string): Promise<DaemonMetadataRead> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (cause) {
    return errorCode(cause) === "ENOENT"
      ? { status: "missing" }
      : { status: "unreadable", cause };
  }
  try {
    const parsed = daemonFileSchema.safeParse(JSON.parse(raw));
    return parsed.success
      ? { status: "valid", daemon: parsed.data }
      : { status: "invalid", cause: parsed.error };
  } catch (cause) {
    return { status: "invalid", cause };
  }
}

async function readToken(path: string): Promise<string> {
  let token: string;
  try {
    token = (await readFile(path, "utf8")).trim();
  } catch (cause) {
    throw new Error(
      `Nerve daemon authentication metadata at ${path} is unreadable; refusing to start a second daemon.`,
      { cause },
    );
  }
  if (!token) {
    throw new Error(
      `Nerve daemon authentication metadata at ${path} is empty; refusing to start a second daemon.`,
    );
  }
  return token;
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}
