import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { VolumeRef } from "@nervekit/contracts";
export class VolumeManager {
  constructor(private readonly rootDir: string) {}
  async prepare(
    sandboxId: string,
  ): Promise<{ workspace: VolumeRef; state: VolumeRef; secrets: VolumeRef }> {
    const base = path.join(this.rootDir, sandboxId);
    const workspace = path.join(base, "workspace");
    const state = path.join(base, "state");
    const secrets = path.join(base, "secrets");
    await Promise.all(
      [workspace, state, secrets].map((dir) =>
        mkdir(dir, { recursive: true, mode: dir === secrets ? 0o700 : 0o755 }),
      ),
    );
    return {
      workspace: { kind: "bind", source: workspace, target: "/workspace" },
      state: { kind: "bind", source: state, target: "/state" },
      secrets: {
        kind: "bind",
        source: secrets,
        target: "/secrets",
        readonly: true,
      },
    };
  }
}
