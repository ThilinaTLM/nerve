import type { DaemonConnectionPorts } from "./ports.js";
import {
  buildOrchestratorEnv,
  resolveDaemonPaths,
  resolveReadinessTimeoutMs,
  wantsLanAccess,
} from "./profile.js";
import { DaemonSupervisor } from "./supervisor.js";
import type { EnsureDaemonOptions, ManagedDaemon } from "./types.js";
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

  if (!(await ports.health.isHealthy(url, token))) {
    throw new Error(`Could not connect to remote Nerve daemon at ${url}.`);
  }
  const supervisor = new DaemonSupervisor(
    {
      mode: "remote",
      owned: false,
      readinessTimeoutMs: resolveReadinessTimeoutMs(ports.env),
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
  const readinessTimeoutMs = resolveReadinessTimeoutMs(ports.env);
  const existing = await ports.discovery.findHealthyDaemon(paths);
  if (existing) {
    if (
      wantsLanAccess(options, ports.env) &&
      isLoopbackHost(existing.daemon.host)
    ) {
      throw new Error(
        `A Nerve daemon is already running at ${existing.url}, but it is bound to ${existing.daemon.host} and cannot accept LAN clients. Stop the existing daemon, then run pnpm desktop again.`,
      );
    }
    if (options.mobileHttps && !existing.daemon.mobileHttps) {
      throw new Error(
        `A Nerve daemon is already running at ${existing.url}, but mobile HTTPS is not enabled. Stop the existing daemon, then run with --mobile-https again.`,
      );
    }
    ports.logger.log("info", "Using existing healthy local daemon", {
      context: { url: existing.url },
    });
    const supervisor = new DaemonSupervisor(
      { mode: "local", owned: false, paths, readinessTimeoutMs },
      ports,
    );
    return supervisor.initMonitorOnly(existing);
  }

  const serverMain = ports.resolveServerMain();
  if (!(await ports.fileExists(serverMain))) {
    throw new Error(
      `Nerve workbench server build was not found at ${serverMain}. Run pnpm --filter @nervekit/workbench-server build first.`,
    );
  }

  const supervisor = new DaemonSupervisor(
    {
      mode: "local",
      owned: true,
      paths,
      serverMain,
      launchEnv: buildOrchestratorEnv(options, ports.env),
      readinessTimeoutMs,
    },
    ports,
  );
  return supervisor.startOwned();
}
