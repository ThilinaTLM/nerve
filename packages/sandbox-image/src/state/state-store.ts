import { access, chmod, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import type { SandboxConfigV1 } from "@nervekit/shared";
import { canonicalJson } from "../config/digest.js";
import { StateLock, StateLockConflictError } from "./file-lock.js";
import { atomicWriteFile } from "./json-store.js";
import {
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
): Promise<PersistedConfigState> {
  try {
    await mkdir(paths.stateDir, { recursive: true });
    for (const directory of stateSubdirectories(paths)) {
      await mkdir(directory, { recursive: true });
    }
    await protectDirectory(paths.credentialsDir);
    await protectDirectory(paths.secretCacheDir);
    await assertWritable(paths.stateDir);
    const lock = await StateLock.acquire(paths.stateDir);
    void lock;
    const now = new Date().toISOString();
    await atomicWriteFile(
      path.join(paths.stateDir, "VERSION"),
      `${JSON.stringify({ format: "nerve-sandbox-state", version: 1, initializedAt: now })}\n`,
    );
    await atomicWriteFile(
      path.join(paths.configDir, "sanitized.json"),
      `${canonicalJson(config)}\n`,
    );
    await atomicWriteFile(
      path.join(paths.configDir, "digest.txt"),
      `${configDigest}\n`,
    );
    await atomicWriteFile(
      path.join(paths.configDir, "effective.json"),
      `${JSON.stringify(effectiveConfigSummary(config, paths), null, 2)}\n`,
    );
    await atomicWriteFile(
      path.join(paths.stateDir, "status.json"),
      `${JSON.stringify({ status: "ready", configDigest, updatedAt: now }, null, 2)}\n`,
    );
    await atomicWriteFile(
      path.join(paths.stateDir, "controller", "connectivity.json"),
      `${JSON.stringify({ state: "reconnecting", reconnectAttempts: 0, updatedAt: now }, null, 2)}\n`,
    );
  } catch (error) {
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

function effectiveConfigSummary(
  config: SandboxConfigV1,
  paths: SandboxRuntimePaths,
): Record<string, unknown> {
  return {
    version: config.version,
    sandboxId: config.identity?.sandboxId,
    workspaceDir: paths.workspaceDir,
    stateDir: paths.stateDir,
    mainModel: config.agent.mainModel,
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
