import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { fileURLToPath } from "node:url";
import {
  serializeCrashError,
  writeCrashReportSync,
} from "../../crash-reports.js";
import { desktopLog } from "../../logging.js";
import type { DaemonConnectionPorts } from "../ports.js";
import type { NetworkInterfacesSnapshot } from "../urls.js";
import { findHealthyDaemon } from "./daemon-discovery.js";
import { checkHealth } from "./daemon-health.js";
import {
  captureDiagnosticReport,
  resolveDaemonLaunch,
} from "./node-launcher.js";

/** Compose focused Node adapters behind the daemon runtime ports. */
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
