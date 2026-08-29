import { homedir } from "node:os";
import { join } from "node:path";
import type { DaemonPaths, EnsureDaemonOptions } from "./contracts.js";
import { isLoopbackHost } from "./urls.js";

/**
 * Profile/environment policy for the daemon. Electron's browser profile stays
 * outside `NERVE_HOME` so whole-home backup and migration remain safe; only
 * explicit `NERVE_HOME` overrides move the daemon state directory.
 */

const DEFAULT_READINESS_TIMEOUT_MS = 60_000;
const DEFAULT_DAEMON_MAX_OLD_SPACE_MB = 4096;

export function resolveDaemonPaths(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): DaemonPaths {
  const explicitHome = env.NERVE_HOME;
  const resolved = explicitHome?.trim() ? explicitHome : join(home, ".nerve");
  return {
    home: resolved,
    daemonPath: join(resolved, "daemon.json"),
    localTokenPath: join(resolved, "secrets", "daemon-token"),
  };
}

export function resolveReadinessTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
  configured = DEFAULT_READINESS_TIMEOUT_MS,
): number {
  const raw = env.NERVE_DAEMON_STARTUP_TIMEOUT_MS?.trim();
  if (!raw) return configured;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return configured;
  }
  return Math.max(1, Math.trunc(value));
}

export function resolveDaemonMaxOldSpaceMb(
  env: NodeJS.ProcessEnv = process.env,
  configured = DEFAULT_DAEMON_MAX_OLD_SPACE_MB,
): number {
  const raw = env.NERVE_DAEMON_MAX_OLD_SPACE_MB?.trim();
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : configured;
}

export function buildOrchestratorArgs(options: EnsureDaemonOptions): string[] {
  return [
    ...(options.host ? ["--host", options.host] : []),
    ...(options.port ? ["--port", String(options.port)] : []),
    ...(options.httpsPort ? ["--https-port", String(options.httpsPort)] : []),
    ...(options.allowRemote ? ["--allow-remote"] : []),
    ...(options.mobileHttps ? ["--mobile-https"] : []),
  ];
}

/** Launch environment for the owned workbench-server child. */
export function buildOrchestratorEnv(
  options: EnsureDaemonOptions,
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const nodeOptions = [
    env.NODE_OPTIONS,
    `--max-old-space-size=${resolveDaemonMaxOldSpaceMb(
      env,
      options.maxOldSpaceMb,
    )}`,
  ]
    .filter(Boolean)
    .join(" ");
  const childEnv = { ...env };
  if (childEnv.NERVE_DESKTOP_SYNTHETIC_PERFORMANCE === "1") {
    delete childEnv.NERVE_PERFORMANCE_DIAGNOSTICS;
    delete childEnv.NERVE_DESKTOP_SYNTHETIC_PERFORMANCE;
  }
  return {
    ...childEnv,
    ELECTRON_RUN_AS_NODE: "1",
    NODE_OPTIONS: nodeOptions,
    ...(options.webDistPath ? { NERVE_WEB_DIST: options.webDistPath } : {}),
  };
}

export function wantsLanAccess(
  options: EnsureDaemonOptions,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const host = options.host ?? env.NERVE_HOST;
  return Boolean(
    options.allowRemote ||
    env.NERVE_ALLOW_REMOTE === "1" ||
    (host && !isLoopbackHost(host)),
  );
}
