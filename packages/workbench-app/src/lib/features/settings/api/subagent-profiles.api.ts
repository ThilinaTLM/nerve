import type {
  SubagentProfilePatch,
  SubagentProfileEntry,
  SubagentProfilesConfiguration,
} from "@nervekit/contracts/subagents";
import { requestWorkbench } from "$lib/application/startup/workbench-connection";

export type ProfileSettingsScope = {
  scope: "user" | "project";
  projectId?: string;
};

export function readSubagentProfiles(
  input: ProfileSettingsScope,
): Promise<SubagentProfilesConfiguration> {
  return requestWorkbench("subagentProfiles.configuration", input);
}

export function updateSubagentProfile(
  input: ProfileSettingsScope & {
    name: string;
    expectedDigest: string | null;
    patch: SubagentProfilePatch;
  },
): Promise<SubagentProfilesConfiguration> {
  return requestWorkbench("subagentProfiles.update", input);
}

export function resetSubagentProfile(
  input: ProfileSettingsScope & {
    name: string;
    expectedDigest: string | null;
    field?: keyof SubagentProfileEntry;
  },
): Promise<SubagentProfilesConfiguration> {
  return requestWorkbench("subagentProfiles.reset", input);
}

export async function trustSubagentProfile(input: {
  projectId: string;
  digest: string;
}): Promise<SubagentProfilesConfiguration> {
  return requestWorkbench("subagentProfiles.trust", input);
}
