import type { AgentProfile } from "@nervekit/contracts/agent-profiles";
import {
  onAnyEvent,
  onWorkbenchReconnect,
} from "$lib/application/events/workbench-event-bus";
import { requestWorkbench } from "$lib/application/startup/workbench-connection";

/** Profiles a lead conversation can switch to: enabled, unblocked and not sub-agent only. */
export function leadAgentProfiles(
  profiles: readonly AgentProfile[],
): AgentProfile[] {
  return profiles.filter(
    (profile) =>
      profile.enabled && !profile.error && profile.usableBy !== "subagent",
  );
}

const noProject = "";

/** Resolved agent profiles per project, refreshed when profile documents change. */
class AgentProfileCatalog {
  private entries = $state<Record<string, AgentProfile[]>>({});
  private readonly inFlight = new Map<string, Promise<AgentProfile[]>>();
  private listening = false;

  profiles(projectId: string | undefined): AgentProfile[] {
    return this.entries[projectId ?? noProject] ?? [];
  }

  loaded(projectId: string | undefined): boolean {
    return (projectId ?? noProject) in this.entries;
  }

  ensure(projectId: string | undefined): Promise<AgentProfile[]> {
    this.listen();
    return this.loaded(projectId)
      ? Promise.resolve(this.profiles(projectId))
      : this.refresh(projectId);
  }

  refresh(projectId: string | undefined): Promise<AgentProfile[]> {
    const key = projectId ?? noProject;
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const request = requestWorkbench(
      "agentProfiles.list",
      projectId ? { projectId } : undefined,
    )
      .then(({ profiles }) => {
        this.entries[key] = profiles;
        return profiles;
      })
      .catch(() => this.profiles(projectId))
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, request);
    return request;
  }

  private listen(): void {
    if (this.listening) return;
    this.listening = true;
    const refreshLoaded = () => {
      for (const key of Object.keys(this.entries))
        void this.refresh(key === noProject ? undefined : key);
    };
    onAnyEvent((event) => {
      if (event.type === "agentProfiles.changed") refreshLoaded();
    });
    onWorkbenchReconnect(refreshLoaded);
  }
}

export const agentProfileCatalog = new AgentProfileCatalog();
