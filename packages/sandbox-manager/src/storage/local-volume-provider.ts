import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SandboxConfigV1 } from "@nervekit/shared";
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
    await Promise.all(
      [paths.workspace, paths.state, paths.secrets, paths.configDir].map(
        (dir) =>
          mkdir(dir, {
            recursive: true,
            mode: dir === paths.secrets ? 0o700 : 0o755,
          }),
      ),
    );
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
      mkdir(paths.configDir, { recursive: true, mode: 0o755 }),
      mkdir(paths.secrets, { recursive: true, mode: 0o700 }),
    ]);
    await Promise.all([
      writeFile(paths.configPath, files.configYaml, {
        encoding: "utf8",
        mode: 0o600,
      }),
      writeFile(paths.controllerTokenPath, `${files.controllerToken}\n`, {
        encoding: "utf8",
        mode: 0o600,
      }),
    ]);
    return this.prepare(sandboxId, {} as SandboxConfigV1);
  }

  private paths(sandboxId: string) {
    const base = path.join(this.rootDir, sandboxId);
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
