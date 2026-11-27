import type { ProfileCatalogEntry } from "@nervekit/contracts/agent-configuration";
export type ProfileOption = {
  name: string;
  label: string;
  whenToUse: string;
  usableBy: "lead" | "subagent" | "both";
  defaultEnabled: boolean;
  applicable?: boolean;
  error?: string;
  digest?: string;
  source?: "builtin" | "user" | "project";
  /** The user's decision on a user or project profile; built-ins have none. */
  trustState?: "needs_review" | "trusted" | "declined";
};
import {
  onAnyEvent,
  onWorkbenchReconnect,
} from "$lib/application/events/workbench-event-bus";
import { KeyedLoader } from "$lib/application/refresh/keyed-loader";
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

/**
 * Lead profiles that would be offered but wait for the user's review: the
 * picker and `/profile` list them disabled with Review. Declined ones stay
 * hidden (the user's choice).
 */
export function pendingLeadProfiles(
  profiles: readonly ProfileOption[],
): ProfileOption[] {
  return profiles.filter(
    (profile) =>
      profile.trustState === "needs_review" &&
      profile.applicable !== false &&
      profile.usableBy !== "subagent",
  );
}

const noProject = "";

/** Resolved agent profiles per project, refreshed when profile documents change. */
class AgentProfileCatalog {
  // A failed read keeps the last profiles (or none) until the next refresh.
  private readonly loader = new KeyedLoader<string, ProfileOption[]>({
    load: (key) =>
      requestWorkbench("agentProfiles.list", {
        scope:
          key === noProject
            ? { scope: "user" }
            : { scope: "project", projectId: key },
      }).then(({ profiles }) => profiles.map(profileOption)),
  });
  private listening = false;

  profiles(projectId: string | undefined): ProfileOption[] {
    return this.loader.get(projectId ?? noProject) ?? [];
  }

  loaded(projectId: string | undefined): boolean {
    return this.loader.has(projectId ?? noProject);
  }

  async ensure(projectId: string | undefined): Promise<ProfileOption[]> {
    this.listen();
    return (await this.loader.ensure(projectId ?? noProject)) ?? [];
  }

  async refresh(projectId: string | undefined): Promise<ProfileOption[]> {
    return (await this.loader.refresh(projectId ?? noProject)) ?? [];
  }

  private listen(): void {
    if (this.listening) return;
    this.listening = true;
    const refreshLoaded = () => {
      for (const key of this.loader.keys())
        if (this.loader.has(key)) void this.loader.refresh(key);
    };
    onAnyEvent((event) => {
      // A decision on a profile makes it offered or not (picker, `/profile`).
      if (
        event.type === "agentProfiles.changed" ||
        (event.type === "configuration.decided" &&
          (event.data.target as { kind?: string } | undefined)?.kind ===
            "agent-profile")
      )
        refreshLoaded();
    });
    onWorkbenchReconnect(refreshLoaded);
  }
}

export const agentProfileCatalog = new AgentProfileCatalog();

function profileOption(entry: ProfileCatalogEntry): ProfileOption {
  return {
    name: entry.name,
    label: entry.definition?.label ?? entry.name,
    whenToUse: entry.definition?.whenToUse ?? "Definition unavailable",
    usableBy: entry.definition?.usableBy ?? "both",
    defaultEnabled: entry.definition?.enabled ?? true,
    applicable: entry.applicable,
    digest: entry.digest,
    source: entry.source,
    ...(entry.trustState ? { trustState: entry.trustState } : {}),
    error:
      entry.definition && entry.trustState === "trusted"
        ? undefined
        : entry.diagnostics.map((d) => d.code).join(", ") ||
          "Profile unavailable or untrusted",
  };
}
