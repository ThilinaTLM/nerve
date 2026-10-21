import type {
  AgentProfilePatch,
  AgentProfileEntry,
  AgentProfilesConfiguration,
} from "@nervekit/contracts/agent-profiles";
import { requestWorkbench } from "$lib/application/startup/workbench-connection";

export type ProfileSettingsScope = {
  scope: "user" | "project";
  projectId?: string;
};

export function readAgentProfiles(
  input: ProfileSettingsScope,
): Promise<AgentProfilesConfiguration> {
  return requestWorkbench("agentProfiles.configuration", input);
}

export function updateAgentProfile(
  input: ProfileSettingsScope & {
    name: string;
    expectedDigest: string | null;
    patch: AgentProfilePatch;
  },
): Promise<AgentProfilesConfiguration> {
  return requestWorkbench("agentProfiles.update", input);
}

export function resetAgentProfile(
  input: ProfileSettingsScope & {
    name: string;
    expectedDigest: string | null;
    field?: keyof AgentProfileEntry;
  },
): Promise<AgentProfilesConfiguration> {
  return requestWorkbench("agentProfiles.reset", input);
}

export async function trustAgentProfile(input: {
  projectId: string;
  digest: string;
}): Promise<AgentProfilesConfiguration> {
  return requestWorkbench("agentProfiles.trust", input);
}
