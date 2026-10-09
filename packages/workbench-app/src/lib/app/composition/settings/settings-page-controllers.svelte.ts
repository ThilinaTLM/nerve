import {
  emptyCapabilityOverrides,
  type CapabilityConfiguration,
  type CapabilityPatch,
} from "@nervekit/contracts/capabilities";
import type { Project } from "@nervekit/contracts/core";
import { createCapabilityMutationQueue } from "$lib/domain/capabilities/capability-mutation-queue";
import {
  getCapabilityConfiguration,
  updateCapabilities,
  trustCapabilities,
} from "$lib/features/conversations/adapters/core-capabilities.adapter";
import {
  observeConversationChannel,
  requestConversation,
} from "$lib/application/startup/conversation-connection";
import { onEvent } from "$lib/application/events/workbench-event-bus";
import { settingsState } from "$lib/features/settings/state/settings-state.svelte";
import type { Settings } from "$lib/api";
import { selection } from "$lib/application/workspace/selection.svelte";
import {
  retainConversationStore,
  type ConversationStore,
} from "$lib/features/conversations";
import { StoragePageController } from "$lib/features/settings/views/pages/storage/storage-page-state.svelte";
export type SettingsScope = "user" | "project";
export function createSettingsPageControllers(deps: {
  activeProject: () => Project | undefined;
  scope: () => SettingsScope;
}) {
  let capabilityConfiguration = $state<CapabilityConfiguration>();
  let capabilityLoading = $state(false);
  let capabilityError = $state<string>();
  let capabilityRequest = 0;

  async function loadProjectCapabilities(): Promise<void> {
    const projectId = deps.activeProject()?.id;
    const request = ++capabilityRequest;
    capabilityError = undefined;
    if (!projectId) {
      capabilityConfiguration = undefined;
      return;
    }
    capabilityLoading = true;
    try {
      const configuration = await getCapabilityConfiguration(projectId);
      if (request === capabilityRequest)
        capabilityConfiguration = configuration;
    } catch (error) {
      if (request === capabilityRequest)
        capabilityError =
          error instanceof Error ? error.message : String(error);
    } finally {
      if (request === capabilityRequest) capabilityLoading = false;
    }
  }

  $effect(() => {
    const projectId = deps.activeProject()?.id;
    const scope = deps.scope();
    if (scope === "project" && projectId) void loadProjectCapabilities();
  });

  /** Mutations are serialized so each one sends the digest the server just echoed. */
  const capabilityMutations = createCapabilityMutationQueue();

  async function runCapabilityMutation(
    mutation: () => Promise<CapabilityConfiguration | void>,
  ): Promise<void> {
    await capabilityMutations.run(async () => {
      try {
        const configuration = await mutation();
        if (configuration) capabilityConfiguration = configuration;
        else await loadProjectCapabilities();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await loadProjectCapabilities();
        capabilityError = message;
      }
    });
  }

  async function patchProjectCapabilities(
    patch: CapabilityPatch,
  ): Promise<void> {
    const project = deps.activeProject();
    if (!project || !capabilityConfiguration) return;
    // The digest is read when the mutation runs, after any queued write applied.
    await runCapabilityMutation(() =>
      updateCapabilities({
        projectId: project.id,
        layer: "project",
        patch,
        expectedDigest: capabilityConfiguration?.projectDigest,
      }),
    );
  }

  async function resetProjectCapabilities(): Promise<void> {
    const project = deps.activeProject();
    if (!project || !capabilityConfiguration) return;
    await runCapabilityMutation(() =>
      updateCapabilities({
        projectId: project.id,
        layer: "project",
        replace: emptyCapabilityOverrides(),
        expectedDigest: capabilityConfiguration?.projectDigest,
      }),
    );
  }

  async function setProjectCapabilityTrust(trusted: boolean): Promise<void> {
    const project = deps.activeProject();
    if (!project || !capabilityConfiguration) return;
    await runCapabilityMutation(async () => {
      const digest = capabilityConfiguration?.projectDigest;
      if (!digest)
        throw new Error("Project capability configuration is not loaded.");
      if (trusted) return trustCapabilities(project.id, digest);
      const resources = await requestConversation("trust.list", {
        projectId: project.id,
        kind: "project_capabilities",
      });
      const path =
        project.directory.replaceAll("\\", "/").replace(/\/$/, "") +
        "/.nerve/config/capabilities.json";
      for (const resource of resources) {
        if (resource.path.replaceAll("\\", "/") === path)
          await requestConversation("trust.delete", {
            trustedResourceId: resource.id,
          });
      }
      return getCapabilityConfiguration(project.id);
    });
  }

  $effect(() => {
    const refresh = () =>
      deps.scope() === "project"
        ? loadProjectCapabilities()
        : Promise.resolve();
    const stop = observeConversationChannel({
      recover: refresh,
      disconnected() {},
      event() {},
      notice(notice) {
        if (
          notice.type === "capabilities.changed" &&
          notice.data.projectId === deps.activeProject()?.id &&
          !notice.data.conversationId
        )
          void refresh();
      },
    });
    const stopSettings = onEvent("settings.updated", () => void refresh());
    return () => {
      stop();
      stopSettings();
    };
  });
  let activeStore = $state<ConversationStore>();
  $effect(() => {
    const id = selection.conversationId;
    if (!id) {
      activeStore = undefined;
      return;
    }
    const retained = retainConversationStore(id);
    activeStore = retained.store;
    void retained.ready.catch(() => undefined);
    return retained.release;
  });
  const storageController = new StoragePageController();
  function readComposerSelection(): Settings["lastAgentSelection"] {
    const saved = settingsState.settingsDraft?.lastAgentSelection;
    if (!saved) throw new Error("Settings not loaded");
    const config = activeStore?.snapshot?.config;
    return config
      ? {
          ...saved,
          mode: config.mode,
          model: config.model,
          thinkingLevel: config.reasoningLevel,
          permissionRuleSetId: config.permissionRuleSetId,
        }
      : { ...saved };
  }
  return {
    get capabilityConfiguration() {
      return capabilityConfiguration;
    },
    get capabilityLoading() {
      return capabilityLoading;
    },
    get capabilityError() {
      return capabilityError;
    },
    loadProjectCapabilities,
    patchProjectCapabilities,
    resetProjectCapabilities,
    setProjectCapabilityTrust,
    storageController,
    readComposerSelection,
  };
}
export type SettingsPageControllers = ReturnType<
  typeof createSettingsPageControllers
>;
