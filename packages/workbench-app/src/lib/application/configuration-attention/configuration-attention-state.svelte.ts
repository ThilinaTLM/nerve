import { createDebouncedTask } from "@nervekit/primitives";
import type { ConfigurationResource } from "@nervekit/contracts/configuration";
import { projectConfigurationHealth } from "$lib/application/project-configuration/project-configuration-health-state.svelte";
import { settingsHealth } from "$lib/application/settings/settings-health-state.svelte";
import { openFilePane } from "$lib/features/filesystem/state/file-tabs.svelte";
import { requestConversation } from "$lib/application/startup/conversation-connection";
import { agentProfileCatalog } from "$lib/application/agent-profiles/agent-profile-catalog.svelte";
import {
  attentionEntries,
  type AttentionEntry,
  type ProfilePageOf,
} from "./configuration-attention";

/**
 * What is broken or waits for the user, from the resource registry, for user
 * scope and one project. Held in memory only; the bell, the settings navigation
 * and the guide rows read it.
 */
class ConfigurationAttentionController {
  /** The project the resources were read for. */
  projectId = $state<string>();
  resources = $state<readonly ConfigurationResource[]>([]);
  error = $state<string>();
  /** The resources are a real read for `projectId`, not the empty start state. */
  loaded = $state(false);
  #request = 0;
  #refreshSoon = createDebouncedTask(() => void this.refresh(), 300);

  /** Files the settings-health and project-configuration entries already show. */
  get shownPaths(): string[] {
    return [
      ...settingsHealth.notice.health.invalid.map((item) => item.path),
      ...projectConfigurationHealth
        .issuesFor(this.projectId)
        .filter((issue) => issue.classification !== "migrated")
        .flatMap((issue) => [issue.path, ...(issue.files ?? [])]),
    ];
  }

  get entries(): AttentionEntry[] {
    return attentionEntries(
      this.resources,
      this.shownPaths,
      this.#profilePageOf,
    );
  }

  /** A sub-agent-only profile is decided on Sub-agents; the rest on Agents. */
  #profilePageOf: ProfilePageOf = (scope, name) => {
    const profile = agentProfileCatalog
      .profiles(scope === "project" ? this.projectId : undefined)
      .find(
        (option) =>
          option.name === name && (option.source ?? "builtin") === scope,
      );
    return profile?.usableBy === "subagent" ? "sub-agents" : undefined;
  };

  /** Opens a project file the entry names, in the project it was read for. */
  async openFile(path: string): Promise<void> {
    if (this.projectId) await openFilePane({ projectId: this.projectId, path });
  }

  /** User items, and project items only when they were read for this project. */
  entriesFor(projectId: string | undefined): AttentionEntry[] {
    return this.entries.filter(
      (entry) =>
        entry.scope === "user" ||
        (projectId !== undefined && this.projectId === projectId),
    );
  }

  async refresh(projectId = this.projectId): Promise<void> {
    this.#refreshSoon.cancel();
    const request = ++this.#request;
    try {
      const { resources } = await requestConversation(
        "configuration.attention",
        { ...(projectId ? { projectId } : {}) },
      );
      if (request !== this.#request) return;
      this.projectId = projectId;
      this.resources = resources;
      this.loaded = true;
      this.error = undefined;
      // A profile's page depends on who may use it; read once something waits.
      if (
        resources.some(
          (resource) =>
            resource.kind === "agent-profile" &&
            resource.state === "needs_review",
        )
      )
        void agentProfileCatalog.ensure(projectId);
    } catch (error) {
      if (request !== this.#request) return;
      this.error =
        error instanceof Error
          ? error.message
          : "Could not check configuration.";
    }
  }

  /** Change events arrive in bursts; one read follows the last. */
  refreshSoon(): void {
    this.#refreshSoon.schedule();
  }

  /** The project closed or changed: nothing from the old one stays. */
  reset(projectId: string | undefined): void {
    if (projectId === this.projectId) return;
    this.#request++;
    this.projectId = projectId;
    this.resources = [];
    this.loaded = false;
  }
}

export const configurationAttention = new ConfigurationAttentionController();
