import { spawn } from "node:child_process";
import type { DaemonChildHandle, DaemonChildLauncherPort } from "../ports.js";
import { captureDiagnosticReport } from "./diagnostic-report.js";
import {
  type DaemonLaunchCommand,
  systemdStopCommand,
} from "./systemd-scope.js";

export function spawnDaemonProcess(
  input: Parameters<DaemonChildLauncherPort["launch"]>[0],
  launch: DaemonLaunchCommand,
): DaemonChildHandle {
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
    kill: (signal) => child.kill(signal),
    requestDiagnosticReport: (dataDir) =>
      captureDiagnosticReport(child, dataDir),
  };
}
