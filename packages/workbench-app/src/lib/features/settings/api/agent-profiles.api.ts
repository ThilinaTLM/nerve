import type {
  PreferenceScope,
  ListScopedProfilesResult,
  ReadScopedProfileResult,
  SaveScopedProfileRequest,
  DeleteScopedProfileRequest,
  ProfileMutationResult,
  ScopedTrustRequest,
  ScopedTrustResult,
} from "@nervekit/contracts/agent-configuration";
import { requestWorkbench } from "$lib/application/startup/workbench-connection";
export type ProfileSettingsScope = PreferenceScope;
export function readAgentProfiles(
  scope: PreferenceScope,
): Promise<ListScopedProfilesResult> {
  return requestWorkbench("agentProfiles.list", { scope });
}
export function readScopedProfile(
  scope: PreferenceScope,
  name: string,
): Promise<ReadScopedProfileResult> {
  return requestWorkbench("agentProfiles.read", { scope, name });
}
export function saveScopedProfile(
  input: SaveScopedProfileRequest,
): Promise<ProfileMutationResult> {
  return requestWorkbench("agentProfiles.save", input);
}
export function resetAgentProfile(
  input: DeleteScopedProfileRequest,
): Promise<ProfileMutationResult> {
  return requestWorkbench("agentProfiles.delete", input);
}
export function trustAgentProfile(
  input: ScopedTrustRequest,
): Promise<ScopedTrustResult> {
  return requestWorkbench("agentProfiles.trust", input);
}
