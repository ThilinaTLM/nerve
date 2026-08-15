import { spawn } from "node:child_process";
import { readFile, access } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { fileURLToPath } from "node:url";
import { type DaemonFile, daemonFileSchema } from "@nervekit/contracts";
import { serializeCrashError, writeCrashReportSync } from "../crash-reports.js";
import { desktopLog } from "../logging.js";
import type {
  DaemonConnectionPorts,
  DaemonHealthCheckResult,
} from "./ports.js";
import type { DaemonPaths, HealthyDaemon } from "./types.js";
import { localConnectUrl, type NetworkInterfacesSnapshot } from "./urls.js";

const HEALTH_CHECK_TIMEOUT_MS = 1500;

/** Thin Node/Electron-shell adapters behind the daemon runtime ports. */
export function createNodeDaemonPorts(): DaemonConnectionPorts {
  return {
    env: process.env,
    health: { check: checkHealth },
    discovery: { findHealthyDaemon },
    launcher: {
      launch: (input) => {
        const child = spawn(
          process.execPath,
          [input.serverMain, ...(input.args ?? [])],
          {
            env: input.env,
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
          },
        );
        child.stdout?.on("data", (chunk) => input.onOutput("stdout", chunk));
        child.stderr?.on("data", (chunk) => input.onOutput("stderr", chunk));
        child.once("error", (error) => input.onError(error));
        child.once("exit", (code, signal) => input.onExit({ code, signal }));
        return {
          get pid() {
            return child.pid;
          },
          kill: (signal) => child.kill(signal),
          requestDiagnosticReport: () =>
            process.platform === "win32" ? false : child.kill("SIGUSR2"),
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
  const daemon = await readDaemonFile(paths.daemonPath);
  if (!daemon) return undefined;

  const url = localConnectUrl(daemon.url);
  if (!url) return undefined;

  const token = await readToken(paths.localTokenPath);
  if (!token) return undefined;

  const health = await checkHealth(url, token);
  return health.healthy ? { daemon, url, token } : undefined;
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
