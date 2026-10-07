import type { DaemonConnectionPorts } from "./ports.js";
import {
  buildOrchestratorArgs,
  buildOrchestratorEnv,
  resolveDaemonHeapProfile,
  resolveDaemonPaths,
  resolveReadinessTimeoutMs,
  wantsLanAccess,
} from "./profile.js";
import { DAEMON_LEASE_CONFLICT_CODE } from "@nervekit/contracts/storage";
import { DaemonStartupError, isDaemonStartupErrorCode } from "./diagnostics.js";
import { DAEMON_READY_POLL_INTERVAL_MS } from "./policy.js";
import { DaemonSupervisor } from "./supervisor.js";
import type {
  EnsureDaemonOptions,
  HealthyDaemon,
  ManagedDaemon,
} from "./contracts.js";
import { isLoopbackHost, normalizeRemoteDaemonUrl } from "./urls.js";

/**
 * `ensureDaemon` orchestration: remote validation/monitoring, existing local
 * daemon discovery with LAN/mobile compatibility checks, or owned local daemon
 * launch. Only the owned path may spawn, restart, signal, or kill a process.
 */
export async function ensureDaemonConnection(
  options: EnsureDaemonOptions,
  ports: DaemonConnectionPorts,
): Promise<ManagedDaemon> {
  if (options.mode === "remote" || options.remoteUrl) {
    ports.logger.log("info", "Connecting to remote daemon", {
      context: { url: options.remoteUrl },
    });
    return connectRemoteDaemon(options, ports);
  }
  ports.logger.log("info", "Ensuring local daemon");
  return ensureLocalDaemon(options, ports);
}

async function connectRemoteDaemon(
  options: EnsureDaemonOptions,
  ports: DaemonConnectionPorts,
): Promise<ManagedDaemon> {
  if (!options.remoteUrl) {
    throw new Error("Missing remote daemon URL. Use --connect <url>.");
  }
  const url = normalizeRemoteDaemonUrl(options.remoteUrl);
  const token = options.token?.trim() || ports.env.NERVE_DAEMON_TOKEN?.trim();
  if (!token) {
    throw new Error(
      "Missing remote daemon token. Use --token <token> or NERVE_DAEMON_TOKEN.",
    );
  }

  if (!(await ports.health.check(url, token)).healthy) {
    throw new Error(`Could not connect to remote Nerve daemon at ${url}.`);
  }
  const supervisor = new DaemonSupervisor(
    {
      mode: "remote",
      owned: false,
      readinessTimeoutMs: resolveReadinessTimeoutMs(
        ports.env,
        options.startupTimeoutMs,
      ),
    },
    ports,
  );
  return supervisor.initMonitorOnly({ url, token });
}

async function ensureLocalDaemon(
  options: EnsureDaemonOptions,
  ports: DaemonConnectionPorts,
): Promise<ManagedDaemon> {
  const paths = resolveDaemonPaths(ports.env);
  const readinessTimeoutMs = resolveReadinessTimeoutMs(
    ports.env,
    options.startupTimeoutMs,
  );
  const existing = await ports.discovery.findHealthyDaemon(paths);
  if (existing) {
    validateExistingDaemon(
      existing,
      options,
      ports.env,
      ports.bundledDaemonVersion,
    );
    return monitorExistingDaemon(existing, paths, readinessTimeoutMs, ports);
  }

  const serverMain = ports.resolveServerMain();
  if (!(await ports.fileExists(serverMain))) {
    throw new Error(
      `Nerve workbench server build was not found at ${serverMain}. Run pnpm --filter @nervekit/workbench-server build first.`,
    );
  }

  const heapProfile = resolveDaemonHeapProfile(
    ports.env,
    options.maxOldSpaceMb,
  );
  if (heapProfile.requestedMb !== heapProfile.effectiveMb) {
    ports.logger.log("warn", "Raised owned daemon heap to supported minimum", {
      context: {
        requestedMaxOldSpaceMb: heapProfile.requestedMb,
        effectiveMaxOldSpaceMb: heapProfile.effectiveMb,
        source: heapProfile.source,
      },
    });
  }

  const supervisor = new DaemonSupervisor(
    {
      mode: "local",
      owned: true,
      paths,
      serverMain,
      launchEnv: buildOrchestratorEnv(options, ports.env, heapProfile),
      launchArgs: buildOrchestratorArgs(options),
      readinessTimeoutMs,
      effectiveMaxOldSpaceMb: heapProfile.effectiveMb,
      onStartupProgress: options.onStartupProgress,
    },
    ports,
  );
  const startedAt = ports.scheduler.now();
  try {
    return await supervisor.startOwned();
  } catch (error) {
    if (!isDaemonStartupErrorCode(error, DAEMON_LEASE_CONFLICT_CODE)) {
      throw error;
    }
    ports.logger.log(
      "info",
      "Waiting to adopt the local daemon that won the startup lease",
    );
    const deadline = startedAt + readinessTimeoutMs;
    do {
      const recovered = await ports.discovery.findHealthyDaemon(paths);
      if (recovered) {
        validateExistingDaemon(
          recovered,
          options,
          ports.env,
          ports.bundledDaemonVersion,
        );
        ports.logger.log("info", "Adopted competing local daemon", {
          context: { url: recovered.url },
        });
        return monitorExistingDaemon(
          recovered,
          paths,
          readinessTimeoutMs,
          ports,
        );
      }
      const remainingMs = deadline - ports.scheduler.now();
      if (remainingMs <= 0) break;
      await ports.scheduler.delay(
        Math.min(DAEMON_READY_POLL_INTERVAL_MS, remainingMs),
      );
    } while (ports.scheduler.now() <= deadline);

    throw new DaemonStartupError(
      `Another Nerve daemon owns the local data directory but did not become ready within ${readinessTimeoutMs}ms. Try again after the other instance finishes starting.`,
      error.daemonOutput,
    );
  }
}

function validateExistingDaemon(
  existing: HealthyDaemon,
  options: EnsureDaemonOptions,
  env: NodeJS.ProcessEnv,
  bundledDaemonVersion: string,
): void {
  if (existing.daemon.version !== bundledDaemonVersion) {
    throw new Error(
      `A Nerve daemon from version ${existing.daemon.version} is already running for this home, but this desktop requires version ${bundledDaemonVersion}. Quit the existing Nerve process, then try again.`,
    );
  }
  if (wantsLanAccess(options, env) && isLoopbackHost(existing.daemon.host)) {
    throw new Error(
      `A Nerve daemon is already running at ${existing.url}, but it is bound to ${existing.daemon.host} and cannot accept LAN clients. Stop the existing daemon through its owner, then restart your desktop with LAN access enabled.`,
    );
  }
  if (options.mobileHttps && !existing.daemon.mobileHttps) {
    throw new Error(
      `A Nerve daemon is already running at ${existing.url}, but mobile HTTPS is not enabled. Stop the existing daemon, then run with --mobile-https again.`,
    );
  }
}

function monitorExistingDaemon(
  existing: HealthyDaemon,
  paths: ReturnType<typeof resolveDaemonPaths>,
  readinessTimeoutMs: number,
  ports: DaemonConnectionPorts,
): ManagedDaemon {
  ports.logger.log("info", "Using existing healthy local daemon", {
    context: { url: existing.url },
  });
  const supervisor = new DaemonSupervisor(
    { mode: "local", owned: false, paths, readinessTimeoutMs },
    ports,
  );
  return supervisor.initMonitorOnly(existing);
}
