import type { SandboxConfigV1, SandboxSecretRef } from "@nervekit/contracts";
export type BootPhase = {
  name: string;
  script: string;
  timeoutMs: number;
  runAs: "sandbox" | "root";
  network: "inherit" | "deny" | "package_registries_only";
  env?: Record<string, SandboxSecretRef>;
};
export function buildBootPlan(config: SandboxConfigV1): BootPhase[] {
  const boot = config.boot;
  if (!boot) return [];
  if (boot.script && boot.phases?.length)
    throw new Error("boot.script and boot.phases are mutually exclusive");
  if (boot.script)
    return [
      {
        name: "boot",
        script: boot.script,
        timeoutMs: boot.timeoutMs ?? 600_000,
        runAs: boot.runAs ?? "sandbox",
        network: boot.network ?? "inherit",
      },
    ];
  return (boot.phases ?? []).map((phase) => ({
    name: phase.name,
    script: phase.script,
    timeoutMs: phase.timeoutMs ?? boot.timeoutMs ?? 600_000,
    runAs: phase.runAs ?? boot.runAs ?? "sandbox",
    network: phase.network ?? boot.network ?? "inherit",
    env: phase.env,
  }));
}
