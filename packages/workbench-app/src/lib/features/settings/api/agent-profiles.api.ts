import type {
  AgentProfileConfiguration,
  AgentProfilePatch,
  AgentProfilesConfiguration,
  AgentProfilesDraft,
  AgentProfilesLeadContext,
} from "@nervekit/contracts/agent-profiles";
import type { OperationParams } from "@nervekit/contracts/operations";
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

/** Each profile is its own file: `expectedDigest` is that file's digest. */
export function updateAgentProfile(
  input: ProfileSettingsScope & {
    name: string;
    expectedDigest: string | null;
    patch: AgentProfilePatch;
  },
): Promise<AgentProfilesConfiguration> {
  return requestWorkbench("agentProfiles.update", input);
}

/** Without `field`, unlinks the local file and exposes the inherited definition. */
export function resetAgentProfile(
  input: ProfileSettingsScope & {
    name: string;
    expectedDigest: string | null;
    field?: OperationParams<"agentProfiles.reset">["field"];
  },
): Promise<AgentProfilesConfiguration> {
  return requestWorkbench("agentProfiles.reset", input);
}

/** Trust is per project file: the profile name and the digest reviewed. */
export function trustAgentProfile(input: {
  projectId: string;
  name: string;
  digest: string;
}): Promise<AgentProfilesConfiguration> {
  return requestWorkbench("agentProfiles.trust", input);
}

/** Resolves in-memory drafts against the current layers without saving them. */
export function previewAgentProfiles(input: {
  projectId: string;
  profiles: AgentProfilesDraft;
  lead: AgentProfilesLeadContext;
}): Promise<AgentProfilesConfiguration> {
  return requestWorkbench("agentProfiles.preview", input);
}

export function profileByName(
  configuration: AgentProfilesConfiguration | undefined,
  name: string,
): AgentProfileConfiguration | undefined {
  return configuration?.profiles.find((profile) => profile.name === name);
}
