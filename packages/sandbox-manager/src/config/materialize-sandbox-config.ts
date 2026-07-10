import {
  type SandboxConfigV1,
  sandboxConfigV1Schema,
} from "@nervekit/contracts";
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
    legacy.agent = migrateLegacyAgentConfig(legacy.agent);
    return sandboxConfigV1Schema.parse(legacy);
  }
  return sandboxConfigV1Schema.parse(input);
}

function migrateLegacyAgentConfig(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const agent = { ...(input as Record<string, unknown>) };
  if (agent.defaultModel === undefined && agent.mainModel !== undefined)
    agent.defaultModel = agent.mainModel;
  if (
    agent.defaultExploreModel === undefined &&
    agent.exploreModel !== undefined
  )
    agent.defaultExploreModel = agent.exploreModel;
  if (agent.defaultMode === undefined && agent.mode !== undefined)
    agent.defaultMode = agent.mode;
  if (
    agent.defaultPermissionLevel === undefined &&
    agent.permissionLevel !== undefined
  )
    agent.defaultPermissionLevel = agent.permissionLevel;
  delete agent.mainModel;
  delete agent.exploreModel;
  delete agent.initialPrompt;
  delete agent.mode;
  delete agent.permissionLevel;
  return agent;
}
