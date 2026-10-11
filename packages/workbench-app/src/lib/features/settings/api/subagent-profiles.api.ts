import type {
  SubagentProfile,
  SubagentProfileDraft,
  SubagentProfileScope,
} from "@nervekit/contracts/subagents";
import { requestWorkbench } from "$lib/application/startup/workbench-connection";

export type { SubagentProfile, SubagentProfileDraft, SubagentProfileScope };

/** Effective profiles plus shadowed and invalid ones. */
export async function listSubagentProfiles(
  projectId?: string,
): Promise<SubagentProfile[]> {
  return (await requestWorkbench("subagentProfiles.list", { projectId }))
    .profiles;
}

export async function saveSubagentProfile(input: {
  scope: SubagentProfileScope;
  projectId?: string;
  profile: SubagentProfileDraft;
  previousName?: string;
}): Promise<SubagentProfile> {
  return (await requestWorkbench("subagentProfiles.save", input)).profile;
}

export async function deleteSubagentProfile(input: {
  scope: SubagentProfileScope;
  projectId?: string;
  name: string;
}): Promise<void> {
  await requestWorkbench("subagentProfiles.delete", input);
}

export async function setSubagentProfileEnabled(
  name: string,
  enabled: boolean,
): Promise<void> {
  await requestWorkbench("subagentProfiles.setEnabled", { name, enabled });
}

export async function trustSubagentProfile(input: {
  projectId: string;
  name: string;
  digest: string;
}): Promise<SubagentProfile> {
  return (await requestWorkbench("subagentProfiles.trust", input)).profile;
}
