import type { ChildProcess } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  DAEMON_DIAGNOSTIC_POLL_INTERVAL_MS,
  DAEMON_DIAGNOSTIC_TIMEOUT_MS,
} from "../policy.js";
import type { DaemonDiagnosticCaptureResult } from "../ports.js";

export async function captureDiagnosticReport(
  child: Pick<ChildProcess, "pid" | "kill">,
  dataDir: string,
): Promise<DaemonDiagnosticCaptureResult> {
  const startedAt = Date.now();
  if (process.platform === "win32")
    return { outcome: "unsupported", elapsedMs: 0 };
  const pid = child.pid;
  if (!pid)
    return {
      outcome: "request_failed",
      elapsedMs: 0,
      error: "Daemon PID is unavailable",
    };
  const directory = join(dataDir, "crashes");
  const before = new Set(await readdir(directory).catch(() => []));
  if (!child.kill("SIGUSR2"))
    return {
      outcome: "request_failed",
      elapsedMs: Date.now() - startedAt,
      error: "SIGUSR2 could not be delivered",
    };
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
      if (candidate.stable >= 2)
        return { outcome: "captured", elapsedMs: Date.now() - startedAt, path };
    } else
      candidate = { path, size: info.size, mtimeMs: info.mtimeMs, stable: 0 };
  }
  return { outcome: "timed_out", elapsedMs: Date.now() - startedAt };
}
