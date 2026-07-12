import { access, chmod, mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { SandboxConfigV1 } from "@nervekit/contracts";
import { stringify as stringifyYaml } from "yaml";
import { canonicalJson } from "../config/digest.js";
import type { SandboxRuntimeIdentity } from "../runtime/identity.js";
import { StateLock, StateLockConflictError } from "./file-lock.js";
import { atomicWriteFile } from "./json-store.js";
import {
  initialStateFiles,
  resolveSandboxRuntimePaths,
  type SandboxRuntimePaths,
  stateSubdirectories,
} from "./state-layout.js";

export class SandboxStateError extends Error {
  constructor(
    message: string,
    readonly exitCode: number,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "SandboxStateError";
  }
}

export type PersistedConfigState = {
  configDigest: string;
  configPath: string;
  stateDir: string;
  workspaceDir: string;
};

export async function initializeSandboxState(
  config: SandboxConfigV1,
  configDigest: string,
  configPath: string,
  paths: SandboxRuntimePaths = resolveSandboxRuntimePaths(),
  identity: Pick<SandboxRuntimeIdentity, "sandboxId"> = {
    sandboxId: "unknown",
  },
): Promise<PersistedConfigState> {
  try {
    await mkdir(paths.stateDir, { recursive: true });
    await assertCompatibleStateLayout(paths);
    for (const directory of stateSubdirectories(paths)) {
      await mkdir(directory, { recursive: true });
    }
    await protectDirectory(paths.credentialsDir);
    await protectDirectory(paths.credentialsOAuthDir);
    await protectDirectory(paths.credentialsSshDir);
    await protectDirectory(paths.credentialsGpgDir);
    await protectDirectory(paths.secretCacheDir);
    await assertWritable(paths.stateDir);
    const lock = await StateLock.acquire(paths.stateDir);
    void lock;
    const now = new Date().toISOString();
    await atomicWriteFile(
      path.join(paths.stateDir, "VERSION"),
      `${JSON.stringify({ format: "nerve-sandbox-agent-state", version: 3, initializedAt: now })}\n`,
    );
    await atomicWriteFile(
      path.join(paths.configDir, "sanitized.json"),
      `${canonicalJson(config)}\n`,
    );
    await atomicWriteFile(
      path.join(paths.configDir, "sanitized.yaml"),
      stringifyYaml(config),
    );
    await atomicWriteFile(
      path.join(paths.configDir, "digest.txt"),
      `${configDigest}\n`,
    );
    await atomicWriteFile(
      path.join(paths.configDir, "effective.json"),
      `${JSON.stringify(effectiveConfigSummary(config, paths, identity), null, 2)}\n`,
    );
    await atomicWriteFile(
      path.join(paths.stateDir, "status.json"),
      `${JSON.stringify({ status: "ready", configDigest, updatedAt: now }, null, 2)}\n`,
    );
    await writeInitialStateFiles(paths, now);
  } catch (error) {
    if (error instanceof SandboxStateError) throw error;
    if (error instanceof StateLockConflictError) {
      throw new SandboxStateError(error.message, error.exitCode, error);
    }
    throw new SandboxStateError(
      `Unable to initialize writable sandbox state at ${paths.stateDir}`,
      11,
      error,
    );
  }

  return {
    configDigest,
    configPath,
    stateDir: paths.stateDir,
    workspaceDir: paths.workspaceDir,
  };
}

async function assertCompatibleStateLayout(
  paths: SandboxRuntimePaths,
): Promise<void> {
  const versionPath = path.join(paths.stateDir, "VERSION");
  try {
    const marker = JSON.parse(await readFile(versionPath, "utf8")) as {
      format?: unknown;
      version?: unknown;
    };
    if (marker.format !== "nerve-sandbox-agent-state" || marker.version !== 3) {
      throw new Error("incompatible marker");
    }
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new SandboxStateError(
        `Incompatible sandbox agent state at ${paths.stateDir}. Reset this directory before starting Nerve Protocol v1.`,
        11,
        error,
      );
    }
  }
  const legacyFiles = [
    path.join(paths.eventsDir, "outbox.jsonl"),
    path.join(paths.eventsDir, "ack.json"),
    path.join(paths.controllerDir, "session.json"),
    path.join(paths.controllerDir, "cursors.json"),
  ];
  for (const legacyPath of legacyFiles) {
    try {
      await access(legacyPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    throw new SandboxStateError(
      `Incompatible sandbox agent state at ${paths.stateDir}. Reset this directory before starting Nerve Protocol v1.`,
      11,
    );
  }
}

async function writeInitialStateFiles(
  paths: SandboxRuntimePaths,
  now: string,
): Promise<void> {
  const defaults = new Map<string, { data: string; mode?: number }>([
    [
      path.join(paths.controllerDir, "session.json"),
      {
        data: `${JSON.stringify({ status: "disconnected", updatedAt: now }, null, 2)}\n`,
        mode: 0o600,
      },
    ],
    [
      path.join(paths.controllerDir, "cursors.json"),
      {
        data: `${JSON.stringify({ streams: [], updatedAt: now }, null, 2)}\n`,
        mode: 0o600,
      },
    ],
    [
      path.join(paths.controllerDir, "connectivity.json"),
      {
        data: `${JSON.stringify({ state: "reconnecting", reconnectAttempts: 0, updatedAt: now }, null, 2)}\n`,
        mode: 0o600,
      },
    ],
    [
      path.join(paths.credentialsDir, "status.json"),
      {
        data: `${JSON.stringify({ credentials: [], updatedAt: now }, null, 2)}\n`,
        mode: 0o600,
      },
    ],
    [
      path.join(paths.secretsDir, "stores.json"),
      {
        data: `${JSON.stringify({ stores: [], updatedAt: now }, null, 2)}\n`,
        mode: 0o600,
      },
    ],
    [
      path.join(paths.secretsDir, "status.json"),
      {
        data: `${JSON.stringify({ stores: [], updatedAt: now }, null, 2)}\n`,
        mode: 0o600,
      },
    ],
    [
      path.join(paths.setupDir, "git.json"),
      {
        data: `${JSON.stringify({ configured: false, status: "skipped", updatedAt: now }, null, 2)}\n`,
      },
    ],
    [
      path.join(paths.setupDir, "github.json"),
      {
        data: `${JSON.stringify({ configured: false, status: "skipped", updatedAt: now }, null, 2)}\n`,
      },
    ],
    [
      path.join(paths.controllerDir, "idempotency", "records.jsonl"),
      { data: "", mode: 0o600 },
    ],
    [
      path.join(paths.controllerDir, "idempotency", "conflicts.jsonl"),
      { data: "", mode: 0o600 },
    ],
    [path.join(paths.eventsDir, "outbox.jsonl"), { data: "" }],
    [
      path.join(paths.eventsDir, "ack.json"),
      { data: `${JSON.stringify({ streams: [], updatedAt: now }, null, 2)}\n` },
    ],
    [
      path.join(paths.skillsDir, "context-files.json"),
      {
        data: `${JSON.stringify({ contextFiles: [], updatedAt: now }, null, 2)}\n`,
      },
    ],
    [
      path.join(paths.skillsDir, "loaded.json"),
      { data: `${JSON.stringify({ skills: [], updatedAt: now }, null, 2)}\n` },
    ],
    [path.join(paths.skillsDir, "diagnostics.jsonl"), { data: "" }],
    [path.join(paths.bootDir, "attempts.jsonl"), { data: "" }],
    [path.join(paths.bootDir, "latest.log"), { data: "" }],
  ]);
  for (const filePath of initialStateFiles(paths)) {
    if (await exists(filePath)) continue;
    const entry = defaults.get(filePath);
    if (entry) await atomicWriteFile(filePath, entry.data, entry.mode);
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function effectiveConfigSummary(
  config: SandboxConfigV1,
  paths: SandboxRuntimePaths,
  identity: Pick<SandboxRuntimeIdentity, "sandboxId">,
): Record<string, unknown> {
  return {
    version: config.version,
    sandboxId: identity.sandboxId,
    workspaceDir: paths.workspaceDir,
    stateDir: paths.stateDir,
    defaultModel: config.agent.defaultModel,
    controller: {
      websocketUrl: config.controller.websocket.url,
      authType: config.controller.auth.type,
      disconnectPolicy: config.controller.disconnectPolicy ?? {
        mode: "exit_self",
        exitAfterMs: 300_000,
      },
    },
    scaffold: true,
  };
}

async function protectDirectory(directory: string): Promise<void> {
  await chmod(directory, 0o700).catch(() => undefined);
}

async function assertWritable(directory: string): Promise<void> {
  await access(directory);
  const probe = path.join(directory, `.write-test-${process.pid}`);
  await atomicWriteFile(probe, "ok");
  await rm(probe, { force: true });
}
