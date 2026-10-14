import {
  onAnyEvent,
  onWorkbenchReconnect,
} from "$lib/application/events/workbench-event-bus";
import {
  readSubagentProfiles,
  type ProfileSettingsScope,
} from "../api/subagent-profiles.api";

export const subagentProfilesState = $state({
  configuration: undefined as
    | import("@nervekit/contracts/subagents").SubagentProfilesConfiguration
    | undefined,
  scope: "user" as ProfileSettingsScope["scope"],
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
  scope: ProfileSettingsScope["scope"] = subagentProfilesState.scope,
): Promise<void> {
  const current = ++request;
  if (
    subagentProfilesState.projectId !== projectId ||
    subagentProfilesState.scope !== scope
  ) {
    subagentProfilesState.configuration = undefined;
    subagentProfilesState.loaded = false;
    subagentProfilesState.error = undefined;
  }
  subagentProfilesState.projectId = projectId;
  subagentProfilesState.scope = scope;
  subagentProfilesState.loading = true;
  try {
    const configuration = await readSubagentProfiles({ scope, projectId });
    if (current !== request) return;
    subagentProfilesState.configuration = configuration;
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
    onAnyEvent((event) => {
      if (
        event.type === "subagentProfiles.changed" ||
        event.type === "applicationConfiguration.updated" ||
        event.type === "settings.updated" ||
        event.type === "project.capabilities.changed" ||
        /^(providers|auth|secrets|skills)\./.test(event.type)
      )
        refresh();
    }),
    onWorkbenchReconnect(refresh),
  ];
  return () => {
    for (const dispose of disposers) dispose();
  };
}
