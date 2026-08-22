import { binding } from "./binding/loader.js";

export type ManagedProcessHostStatus = {
  backend: "cgroup_v2" | "windows_job" | "process_group";
  hardLimitsAvailable: boolean;
  enforcement: "required" | "best_effort";
  detail?: string;
};

let managedProcessHostStatus: ManagedProcessHostStatus | undefined;

export function initializeManagedProcessHost(
  options: {
    delegatedScope?: boolean;
    allowUncontained?: boolean;
  } = {},
): ManagedProcessHostStatus {
  managedProcessHostStatus = binding.initializeManagedProcessHost(options);
  return managedProcessHostStatus;
}

export function managedProcessEnforcement(): "required" | "best-effort" {
  return managedProcessHostStatus?.hardLimitsAvailable
    ? "required"
    : "best-effort";
}

export function nativeRuntimeCapabilities(): {
  platform: string;
  capabilities: string[];
} {
  return binding.runtimeCapabilities();
}
