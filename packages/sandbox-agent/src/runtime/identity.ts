export type SandboxRuntimeIdentity = {
  sandboxId: string;
  instanceId: string;
};

export function resolveSandboxRuntimeIdentity(
  env: NodeJS.ProcessEnv = process.env,
): SandboxRuntimeIdentity {
  return {
    sandboxId: env.NERVE_SANDBOX_AGENT_SANDBOX_ID?.trim() || "unknown",
    instanceId: env.NERVE_SANDBOX_AGENT_INSTANCE_ID ?? `inst_${Date.now()}`,
  };
}
