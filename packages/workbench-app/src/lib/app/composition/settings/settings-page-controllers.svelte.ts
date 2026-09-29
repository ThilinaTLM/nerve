import type {
  CapabilityConfiguration,
  CapabilityPatch,
} from "@nervekit/contracts/capabilities";
import type { ProjectRecord, Settings } from "$lib/api";
import { createCapabilityMutationQueue } from "$lib/domain/capabilities/capability-mutation-queue";
import { conversationState } from "$lib/features/conversations/state/conversation-state.svelte";
import { parseModelKey } from "$lib/presentation/utils/model";
import { PermissionsPageState } from "$lib/features/settings/views/pages/permissions/permissions-page-state.svelte";
import { permissionRuleSetCatalog } from "$lib/application/permissions/permission-rule-set-catalog.svelte";
import {
  getPermissionPolicyConfiguration,
  updatePermissionOverlay,
  updateProjectPermissionTrust,
  getCapabilityConfiguration,
  updateCapabilities,
  updateCapabilityTrust,
} from "$lib/features/projects/api/projects.api";
import { StoragePageController } from "$lib/features/settings/views/pages/storage/storage-page-state.svelte";
import { SuggestionsPageState } from "./suggestions/suggestions-page-state.svelte";

export type SettingsScope = "user" | "project";

/**
 * Per-view settings page state: project capability configuration and the
 * page controllers that own async loading. Shared by the desktop settings
 * shell and the phone settings pages so both render the same page bodies.
 * Must be created during component initialisation.
 */
export function createSettingsPageControllers(deps: {
  activeProject: () => ProjectRecord | undefined;
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
        origin: "project",
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
        origin: "project",
        replace: {
          schemaVersion: 1,
          tools: {},
          skills: { file: {}, nerve: {}, agentBrowser: {} },
        },
        expectedDigest: capabilityConfiguration?.projectDigest,
      }),
    );
  }

  async function setProjectCapabilityTrust(trusted: boolean): Promise<void> {
    const project = deps.activeProject();
    if (!project || !capabilityConfiguration) return;
    await runCapabilityMutation(async () => {
      await updateCapabilityTrust(
        project.id,
        trusted,
        capabilityConfiguration?.projectDigest,
      );
    });
  }

  const permissionsPageState = new PermissionsPageState({
    getConfiguration: getPermissionPolicyConfiguration,
    updateOverlay: updatePermissionOverlay,
    updateTrust: async (projectId, trusted) => {
      await updateProjectPermissionTrust(projectId, trusted);
    },
    onConfigurationLoaded: (projectId, configuration) => {
      permissionRuleSetCatalog.install(projectId, configuration.ruleSets);
    },
  });

  const suggestionsPageState = new SuggestionsPageState();
  const storageController = new StoragePageController();

  /** The composer's live selection is what "remember my last selection" saves. */
  function readComposerSelection(): Settings["lastAgentSelection"] {
    const model = parseModelKey(conversationState.selectedModelKey);
    return {
      mode: conversationState.selectedMode,
      permissionLevel: conversationState.selectedPermissionLevel,
      permissionRuleSetId: conversationState.selectedPermissionRuleSetId,
      ...(model ? { model } : {}),
      thinkingLevel: conversationState.selectedThinkingLevel,
    };
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
    permissionsPageState,
    suggestionsPageState,
    storageController,
    readComposerSelection,
  };
}

export type SettingsPageControllers = ReturnType<
  typeof createSettingsPageControllers
>;
