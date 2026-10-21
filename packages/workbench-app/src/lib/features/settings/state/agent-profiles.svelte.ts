import {
  onAnyEvent,
  onWorkbenchReconnect,
} from "$lib/application/events/workbench-event-bus";
import {
  readAgentProfiles,
  type ProfileSettingsScope,
} from "../api/agent-profiles.api";

export const agentProfilesState = $state({
  configuration: undefined as
    | import("@nervekit/contracts/agent-profiles").AgentProfilesConfiguration
    | undefined,
  scope: "user" as ProfileSettingsScope["scope"],
  loaded: false,
  loading: false,
  error: undefined as string | undefined,
  /** Project whose profiles are listed; undefined lists user and built-in ones. */
  projectId: undefined as string | undefined,
  /** The Agent profiles page is mounted and wants live updates. */
  watching: false,
});

let request = 0;

export async function refreshAgentProfiles(
  projectId: string | undefined = agentProfilesState.projectId,
  scope: ProfileSettingsScope["scope"] = agentProfilesState.scope,
): Promise<void> {
  const current = ++request;
  if (
    agentProfilesState.projectId !== projectId ||
    agentProfilesState.scope !== scope
  ) {
    agentProfilesState.configuration = undefined;
    agentProfilesState.loaded = false;
    agentProfilesState.error = undefined;
  }
  agentProfilesState.projectId = projectId;
  agentProfilesState.scope = scope;
  agentProfilesState.loading = true;
  try {
    const configuration = await readAgentProfiles({ scope, projectId });
    if (current !== request) return;
    agentProfilesState.configuration = configuration;
    agentProfilesState.loaded = true;
    agentProfilesState.error = undefined;
  } catch (error) {
    if (current === request)
      agentProfilesState.error =
        error instanceof Error ? error.message : String(error);
  } finally {
    if (current === request) agentProfilesState.loading = false;
  }
}

export function registerAgentProfileEventHandlers(): () => void {
  const refresh = () => {
    if (agentProfilesState.watching) void refreshAgentProfiles();
  };
  const disposers = [
    onAnyEvent((event) => {
      if (
        event.type === "agentProfiles.changed" ||
        event.type === "applicationConfiguration.updated" ||
        event.type === "settings.updated" ||
        (event.type === "projectSettings.changed" &&
          event.data.projectId === agentProfilesState.projectId) ||
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
