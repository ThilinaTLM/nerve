import { spawn } from "node:child_process";
import type { DaemonChildHandle, DaemonChildLauncherPort } from "../ports.js";
import { captureDiagnosticReport } from "./diagnostic-report.js";
import {
  type DaemonLaunchCommand,
  systemdStopCommand,
} from "./systemd-scope.js";

/** Env flag that makes the daemon shut down gracefully when its stdin closes. */
const SHUTDOWN_ON_STDIN_CLOSE_ENV = "NERVE_SHUTDOWN_ON_STDIN_CLOSE";

/**
 * Windows has no graceful signal: kill("SIGTERM") is TerminateProcess. The
 * daemon watches its stdin instead, so a graceful stop ends stdin and lets the
 * daemon run its shutdown path. SIGKILL stays a hard kill.
 */
export function requestGracefulStop(
  child: {
    stdin?: { writable: boolean; end(): unknown } | null;
    kill(signal: "SIGTERM" | "SIGKILL"): boolean;
  },
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (platform === "win32" && child.stdin?.writable) {
    child.stdin.end();
    return true;
  }
  return child.kill("SIGTERM");
}

export function spawnDaemonProcess(
  input: Parameters<DaemonChildLauncherPort["launch"]>[0],
  launch: DaemonLaunchCommand,
): DaemonChildHandle {
  const child = spawn(launch.command, launch.args, {
    env: { ...launch.env, [SHUTDOWN_ON_STDIN_CLOSE_ENV]: "1" },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  // The pipe is only a shutdown channel: never keep the shell alive for it and
  // ignore EPIPE when the daemon is already gone.
  child.stdin?.on("error", () => undefined);
  (child.stdin as unknown as { unref?: () => void } | null)?.unref?.();
  child.stdout?.on("data", (chunk) => input.onOutput("stdout", chunk));
  child.stderr?.on("data", (chunk) => {
    // Keep the dev terminal log showing server output (e.g. migration lines).
    process.stderr.write(chunk);
    input.onOutput("stderr", chunk);
  });
  child.once("error", (error) => input.onError(error));
  child.once("exit", (code, signal) => {
    if (launch.systemdUnit) {
      const stop = systemdStopCommand(launch.systemdUnit);
      const cleanup = spawn(stop.command, stop.args, {
        stdio: "ignore",
        windowsHide: true,
      });
      cleanup.unref();
    }
    input.onExit({ code, signal });
  });
  return {
    get pid() {
      return child.pid;
    },
    kill: (signal) =>
      signal === "SIGTERM" ? requestGracefulStop(child) : child.kill(signal),
    requestDiagnosticReport: (dataDir) =>
      captureDiagnosticReport(child, dataDir),
  };
}
