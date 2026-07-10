import type { SandboxConfigV1 } from "@nervekit/contracts";
import type {
  PreparedRuntimeVolumes,
  RuntimeVolumeProvider,
} from "./volume-provider.js";

export class S3FilesVolumeProvider implements RuntimeVolumeProvider {
  readonly kind = "s3-files";
  async prepare(
    sandboxId: string,
    _config: SandboxConfigV1,
  ): Promise<PreparedRuntimeVolumes> {
    return {
      workspace: {
        kind: "s3-files",
        name: `${sandboxId}/workspace`,
        target: "/workspace",
      },
      state: { kind: "s3-files", name: `${sandboxId}/state`, target: "/state" },
      secrets: {
        kind: "s3-files",
        name: `${sandboxId}/secrets`,
        target: "/secrets",
        readonly: true,
      },
    };
  }
}
