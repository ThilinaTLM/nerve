import type { SandboxConfigV1 } from "@nervekit/shared";
import type {
  PreparedRuntimeVolumes,
  RuntimeVolumeProvider,
} from "./volume-provider.js";

export class EfsVolumeProvider implements RuntimeVolumeProvider {
  readonly kind = "efs";
  async prepare(
    sandboxId: string,
    _config: SandboxConfigV1,
  ): Promise<PreparedRuntimeVolumes> {
    return {
      workspace: {
        kind: "efs",
        name: `${sandboxId}-workspace`,
        target: "/workspace",
      },
      state: { kind: "efs", name: `${sandboxId}-state`, target: "/state" },
      secrets: {
        kind: "efs",
        name: `${sandboxId}-secrets`,
        target: "/secrets",
        readonly: true,
      },
    };
  }
}
