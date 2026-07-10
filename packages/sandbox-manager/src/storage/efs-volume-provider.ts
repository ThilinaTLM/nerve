import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RemoveOptions, SandboxConfigV1 } from "@nervekit/contracts";
import type {
  PreparedRuntimeVolumes,
  RuntimeMaterialization,
  RuntimeVolumeProvider,
} from "./volume-provider.js";

export type EfsVolumeProviderOptions = {
  mountRoot: string;
  rootDirectory?: string;
};

export class EfsVolumeProvider implements RuntimeVolumeProvider {
  readonly kind = "efs";
  private readonly mountRoot: string;
  private readonly rootDirectory: string;

  constructor(options: EfsVolumeProviderOptions) {
    this.mountRoot = options.mountRoot;
    this.rootDirectory = normalizeEfsRootDirectory(options.rootDirectory);
  }

  async prepare(
    sandboxId: string,
    _config: SandboxConfigV1,
  ): Promise<PreparedRuntimeVolumes> {
    const paths = this.paths(sandboxId);
    await Promise.all([
      ensureDir(paths.workspace, 0o777),
      ensureDir(paths.state, 0o777),
      ensureDir(paths.tmp, 0o777),
      ensureDir(paths.secrets, 0o755),
      ensureDir(paths.configDir, 0o755),
    ]);
    return {
      workspace: {
        kind: "efs",
        name: paths.workspaceRootDirectory,
        source: paths.workspace,
        target: "/workspace",
      },
      state: {
        kind: "efs",
        name: paths.stateRootDirectory,
        source: paths.state,
        target: "/state",
      },
      secrets: {
        kind: "efs",
        name: paths.secretsRootDirectory,
        source: paths.secrets,
        target: "/secrets",
        readonly: true,
      },
      config: {
        kind: "efs",
        name: paths.configRootDirectory,
        source: paths.configPath,
        target: "/etc/nerve",
        readonly: true,
      },
      tmp: {
        kind: "efs",
        name: paths.tmpRootDirectory,
        source: paths.tmp,
        target: "/tmp",
      },
    };
  }

  async materialize(
    sandboxId: string,
    files: RuntimeMaterialization,
  ): Promise<PreparedRuntimeVolumes> {
    const paths = this.paths(sandboxId);
    await Promise.all([
      ensureDir(paths.configDir, 0o755),
      ensureDir(paths.secrets, 0o755),
    ]);
    await Promise.all([
      writeFile(paths.configPath, files.configYaml, {
        encoding: "utf8",
        mode: 0o644,
      }).then(() => chmod(paths.configPath, 0o644)),
      writeFile(paths.controllerTokenPath, `${files.controllerToken}\n`, {
        encoding: "utf8",
        mode: 0o644,
      }).then(() => chmod(paths.controllerTokenPath, 0o644)),
    ]);
    return this.prepare(sandboxId, {} as SandboxConfigV1);
  }

  async remove(sandboxId: string, options: RemoveOptions = {}): Promise<void> {
    if (!options.removeVolumes) return;
    await rm(this.paths(sandboxId).base, { recursive: true, force: true });
  }

  private paths(sandboxId: string) {
    const safeSandboxId = safePathSegment(sandboxId);
    const base = path.join(this.mountRoot, safeSandboxId);
    return {
      base,
      workspace: path.join(base, "workspace"),
      state: path.join(base, "state"),
      secrets: path.join(base, "secrets"),
      configDir: path.join(base, "config"),
      configPath: path.join(base, "config", "sandbox.yaml"),
      controllerTokenPath: path.join(base, "secrets", "controller-token"),
      tmp: path.join(base, "tmp"),
      workspaceRootDirectory: joinEfsRoot(
        this.rootDirectory,
        safeSandboxId,
        "workspace",
      ),
      stateRootDirectory: joinEfsRoot(
        this.rootDirectory,
        safeSandboxId,
        "state",
      ),
      secretsRootDirectory: joinEfsRoot(
        this.rootDirectory,
        safeSandboxId,
        "secrets",
      ),
      configRootDirectory: joinEfsRoot(
        this.rootDirectory,
        safeSandboxId,
        "config",
      ),
      tmpRootDirectory: joinEfsRoot(this.rootDirectory, safeSandboxId, "tmp"),
    };
  }
}

function normalizeEfsRootDirectory(value: string | undefined): string {
  const trimmed = value?.trim() || "/";
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return path.posix.normalize(withSlash).replace(/\/$/, "") || "/";
}

function joinEfsRoot(root: string, ...segments: string[]): string {
  const joined = path.posix.join(root, ...segments);
  return joined.startsWith("/") ? joined : `/${joined}`;
}

function safePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 128) || "sandbox";
}

async function ensureDir(dir: string, mode: number): Promise<void> {
  await mkdir(dir, { recursive: true, mode });
  await chmod(dir, mode);
}
