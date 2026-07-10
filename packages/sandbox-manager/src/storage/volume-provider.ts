import type {
  RemoveOptions,
  SandboxConfigV1,
  VolumeRef,
} from "@nervekit/contracts";

export type RuntimeMaterialization = {
  configYaml: string;
  controllerToken: string;
};

export type PreparedRuntimeVolumes = {
  workspace: VolumeRef;
  state: VolumeRef;
  secrets: VolumeRef;
  config?: VolumeRef;
  tmp?: VolumeRef;
};

export interface RuntimeVolumeProvider {
  readonly kind: "local" | "efs" | "s3-files" | string;
  prepare(
    sandboxId: string,
    config: SandboxConfigV1,
  ): Promise<PreparedRuntimeVolumes>;
  materialize?(
    sandboxId: string,
    files: RuntimeMaterialization,
  ): Promise<PreparedRuntimeVolumes | undefined>;
  remove?(sandboxId: string, options?: RemoveOptions): Promise<void>;
}
