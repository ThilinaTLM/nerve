import {
  onEvent,
  onWorkbenchReconnect,
} from "$lib/application/events/workbench-event-bus";
import {
  listSubagentProfiles,
  type SubagentProfile,
} from "../api/subagent-profiles.api";

export const subagentProfilesState = $state({
  profiles: [] as SubagentProfile[],
  loaded: false,
  loading: false,
  error: undefined as string | undefined,
  /** Project whose profiles are listed; undefined lists user and built-in ones. */
  projectId: undefined as string | undefined,
  /** The Sub-agents page is mounted and wants live updates. */
  watching: false,
});

let request = 0;

export async function refreshSubagentProfiles(
  projectId: string | undefined = subagentProfilesState.projectId,
): Promise<void> {
  const current = ++request;
  subagentProfilesState.projectId = projectId;
  subagentProfilesState.loading = true;
  try {
    const profiles = await listSubagentProfiles(projectId);
    if (current !== request) return;
    subagentProfilesState.profiles = profiles;
    subagentProfilesState.loaded = true;
    subagentProfilesState.error = undefined;
  } catch (error) {
    if (current === request)
      subagentProfilesState.error =
        error instanceof Error ? error.message : String(error);
  } finally {
    if (current === request) subagentProfilesState.loading = false;
  }
}

export function registerSubagentProfileEventHandlers(): () => void {
  const refresh = () => {
    if (subagentProfilesState.watching) void refreshSubagentProfiles();
  };
  const disposers = [
    onEvent("subagentProfiles.changed", refresh),
    onWorkbenchReconnect(refresh),
  ];
  return () => {
    for (const dispose of disposers) dispose();
  };
}
