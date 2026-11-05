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
import { resolveLoginShellPath } from "./login-shell-path.js";
import { DaemonSupervisor } from "./supervisor.js";
import type {
  EnsureDaemonOptions,
  HealthyDaemon,
  ManagedDaemon,
} from "./contracts.js";
import { isLoopbackHost, normalizeRemoteDaemonUrl } from "./urls.js";

let loginShellPath: Promise<string | undefined> | undefined;

/** Resolves the login-shell PATH once per process (darwin only). */
async function withLoginShellPath(
  env: NodeJS.ProcessEnv,
): Promise<NodeJS.ProcessEnv> {
  loginShellPath ??= resolveLoginShellPath(env);
  const PATH = await loginShellPath;
  return PATH ? { ...env, PATH } : env;
}

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
  const credential = await resolveRemoteCredential(url, options, ports);
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
  return supervisor.initMonitorOnly({ url, token: credential });
}

const MISSING_CREDENTIAL_MESSAGE =
  "This desktop is not paired with the remote daemon. Create a code in Nerve (Settings → Devices → Pair a device, or `nerve pair --purpose desktop` on the host) and start with --connect <url> --pair-code <CODE>.";

/**
 * Finds a credential the remote daemon accepts, in order: the device
 * credential stored for this origin, a one-time `--pair-code`, then the
 * deprecated daemon token (exchanged for a device credential when possible).
 * The paired credential is stored per origin, so the code is only needed once.
 */
async function resolveRemoteCredential(
  url: string,
  options: EnsureDaemonOptions,
  ports: DaemonConnectionPorts,
): Promise<string> {
  const origin = new URL(url).origin;
  const stored = await ports.credentials.load(origin);
  if (stored) {
    const health = await ports.health.check(url, stored);
    if (health.healthy) {
      if (options.pairCode) {
        ports.logger.log(
          "info",
          "Ignoring --pair-code: this desktop is already paired with the remote daemon",
        );
      }
      return stored;
    }
    if (health.status !== 401) {
      throw new Error(`Could not connect to remote Nerve daemon at ${url}.`);
    }
    ports.logger.log(
      "warn",
      "The stored device credential was rejected; it was revoked or expired",
    );
    await ports.credentials.forget(origin);
  }

  const pairCode = options.pairCode?.trim();
  const legacyToken =
    options.token?.trim() || ports.env.NERVE_DAEMON_TOKEN?.trim();
  if (!pairCode && !legacyToken) {
    throw new Error(
      stored
        ? `The device credential for ${url} was rejected. ${MISSING_CREDENTIAL_MESSAGE}`
        : MISSING_CREDENTIAL_MESSAGE,
    );
  }

  let credential: string;
  if (pairCode) {
    credential = await redeemForDevice(url, pairCode, ports);
  } else {
    credential = await bootstrapFromLegacyToken(url, legacyToken!, ports);
  }

  const health = await ports.health.check(url, credential);
  if (!health.healthy) {
    throw new Error(`Could not connect to remote Nerve daemon at ${url}.`);
  }
  if (credential !== legacyToken)
    await ports.credentials.save(origin, credential);
  return credential;
}

async function redeemForDevice(
  url: string,
  code: string,
  ports: DaemonConnectionPorts,
): Promise<string> {
  try {
    return await ports.access.redeemPairingCode(url, {
      code,
      deviceName: ports.deviceName,
    });
  } catch (error) {
    throw new Error(
      `Could not pair with the remote Nerve daemon: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

/**
 * `--token` / `NERVE_DAEMON_TOKEN` is deprecated: it only bootstraps a device
 * credential. If that is refused, the token itself still works for one release
 * (the server accepts it from remote peers and flags it), so connecting is not
 * broken, but it is never stored.
 */
async function bootstrapFromLegacyToken(
  url: string,
  token: string,
  ports: DaemonConnectionPorts,
): Promise<string> {
  ports.logger.log(
    "warn",
    "--token and NERVE_DAEMON_TOKEN are deprecated and will be removed. This desktop will pair as a device instead; use --pair-code next time.",
  );
  try {
    const pairing = await ports.access.createPairingCode(url, token, "desktop");
    return await redeemForDevice(url, pairing.code, ports);
  } catch (error) {
    ports.logger.log(
      "warn",
      "Could not exchange the daemon token for a device credential; using the token directly",
      { error },
    );
    return token;
  }
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
      launchEnv: buildOrchestratorEnv(
        options,
        await withLoginShellPath(ports.env),
        heapProfile,
      ),
      launchArgs: buildOrchestratorArgs(options),
      readinessTimeoutMs,
      effectiveMaxOldSpaceMb: heapProfile.effectiveMb,
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
