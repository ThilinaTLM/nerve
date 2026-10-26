import type { ProfileCatalogEntry } from "@nervekit/contracts/agent-configuration";
export type ProfileOption = {
  name: string;
  label: string;
  description: string;
  usableBy: "lead" | "subagent" | "both";
  defaultEnabled: boolean;
  applicable?: boolean;
  error?: string;
  digest?: string;
  source?: "builtin" | "user" | "project";
};
import {
  onAnyEvent,
  onWorkbenchReconnect,
} from "$lib/application/events/workbench-event-bus";
import { requestWorkbench } from "$lib/application/startup/workbench-connection";

/** Profiles a lead conversation can switch to: unblocked and not sub-agent only. */
export function leadAgentProfiles(
  profiles: readonly ProfileOption[],
): ProfileOption[] {
  return profiles.filter(
    (profile) =>
      profile.applicable !== false &&
      !profile.error &&
      profile.usableBy !== "subagent",
  );
}

const noProject = "";

/** Resolved agent profiles per project, refreshed when profile documents change. */
class AgentProfileCatalog {
  private entries = $state<Record<string, ProfileOption[]>>({});
  private readonly inFlight = new Map<string, Promise<ProfileOption[]>>();
  private listening = false;

  profiles(projectId: string | undefined): ProfileOption[] {
    return this.entries[projectId ?? noProject] ?? [];
  }

  loaded(projectId: string | undefined): boolean {
    return (projectId ?? noProject) in this.entries;
  }

  ensure(projectId: string | undefined): Promise<ProfileOption[]> {
    this.listen();
    return this.loaded(projectId)
      ? Promise.resolve(this.profiles(projectId))
      : this.refresh(projectId);
  }

  refresh(projectId: string | undefined): Promise<ProfileOption[]> {
    const key = projectId ?? noProject;
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const request = requestWorkbench("agentProfiles.list", {
      scope: projectId ? { scope: "project", projectId } : { scope: "user" },
    })
      .then(({ profiles }) => {
        const options = profiles.map(profileOption);
        this.entries[key] = options;
        return options;
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

function profileOption(entry: ProfileCatalogEntry): ProfileOption {
  return {
    name: entry.name,
    label: entry.definition?.label ?? entry.name,
    description: entry.definition?.description ?? "Definition unavailable",
    usableBy: entry.definition?.usableBy ?? "both",
    defaultEnabled: entry.definition?.enabled ?? true,
    applicable: entry.applicable,
    digest: entry.digest,
    source: entry.source,
    error:
      entry.definition && entry.trusted
        ? undefined
        : entry.diagnostics.map((d) => d.code).join(", ") ||
          "Profile unavailable or untrusted",
  };
}
