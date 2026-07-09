import { type SandboxConfigV1, sandboxConfigV1Schema } from "@nervekit/shared";
import { stringify } from "yaml";

export function materializeSandboxConfig(config: SandboxConfigV1): string {
  const parsed = sandboxConfigV1Schema.parse(config);
  return stringify(parsed, { sortMapEntries: true });
}

export function parseSandboxConfigInput(input: unknown): SandboxConfigV1 {
  const parsed = sandboxConfigV1Schema.safeParse(input);
  if (parsed.success) return parsed.data;
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const legacy = { ...(input as Record<string, unknown>) };
    delete legacy.identity;
    delete legacy.resources;
    return sandboxConfigV1Schema.parse(legacy);
  }
  return sandboxConfigV1Schema.parse(input);
}
