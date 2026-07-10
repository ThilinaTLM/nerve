import type { NetworkPolicyStatus, SandboxConfigV1 } from "@nervekit/contracts";

export function computeNetworkPolicyStatus(
  config: SandboxConfigV1,
): NetworkPolicyStatus {
  const requestedDefault = config.security?.network?.default ?? "allow";
  const backend = config.security?.firewall?.backend ?? "none";
  return {
    requestedDefault,
    enforcedDefault: backend === "none" ? "unknown" : requestedDefault,
    allowedHosts: config.security?.network?.allow ?? [],
    deniedHosts: config.security?.network?.deny ?? [],
    packageRegistryHosts: config.security?.network?.packageRegistryHosts,
    backend,
    limitations:
      backend === "none"
        ? ["network policy is reported but not enforced in-process"]
        : [],
  };
}
