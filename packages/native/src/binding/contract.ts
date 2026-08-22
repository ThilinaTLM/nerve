import type { GitNativeBinding } from "../git/native-contract.js";
import type { ProcessNativeBinding } from "../process/native-contract.js";

export interface NativeBinding extends GitNativeBinding, ProcessNativeBinding {
  runtimeCapabilities(): { platform: string; capabilities: string[] };
  initializeManagedProcessHost(options: {
    delegatedScope?: boolean;
    allowUncontained?: boolean;
  }): {
    backend: "cgroup_v2" | "windows_job" | "process_group";
    hardLimitsAvailable: boolean;
    enforcement: "required" | "best_effort";
    detail?: string;
  };
}
