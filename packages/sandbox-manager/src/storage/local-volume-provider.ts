import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RemoveOptions, SandboxConfigV1 } from "@nervekit/shared";
import type {
  PreparedRuntimeVolumes,
  RuntimeMaterialization,
  RuntimeVolumeProvider,
} from "./volume-provider.js";

export class LocalVolumeProvider implements RuntimeVolumeProvider {
  readonly kind = "local";

  constructor(private readonly rootDir: string) {}

  async prepare(
    sandboxId: string,
    _config: SandboxConfigV1,
  ): Promise<PreparedRuntimeVolumes> {
    const paths = this.paths(sandboxId);
    await Promise.all([
      ensureDir(paths.workspace, 0o777),
      ensureDir(paths.state, 0o777),
      ensureDir(paths.secrets, 0o755),
      ensureDir(paths.configDir, 0o755),
    ]);
    return {
      workspace: {
        kind: "bind",
        source: paths.workspace,
        target: "/workspace",
      },
      state: { kind: "bind", source: paths.state, target: "/state" },
      secrets: {
        kind: "bind",
        source: paths.secrets,
        target: "/secrets",
        readonly: true,
      },
      config: {
        kind: "bind",
        source: paths.configPath,
        target: "/etc/nerve/sandbox.yaml",
        readonly: true,
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
    if (!("removeVolumes" in options) || !options.removeVolumes) return;
    await rm(this.paths(sandboxId).base, { recursive: true, force: true });
  }

  private paths(sandboxId: string) {
    const base = path.join(this.rootDir, safePathSegment(sandboxId));
    return {
      base,
      workspace: path.join(base, "workspace"),
      state: path.join(base, "state"),
      secrets: path.join(base, "secrets"),
      configDir: path.join(base, "config"),
      configPath: path.join(base, "config", "sandbox.yaml"),
      controllerTokenPath: path.join(base, "secrets", "controller-token"),
    };
  }
}

function safePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 128) || "sandbox";
}

async function ensureDir(dir: string, mode: number): Promise<void> {
  await mkdir(dir, { recursive: true, mode });
  await chmod(dir, mode);
}
