import { SuggestionsPageState } from "./suggestions/suggestions-page-state.svelte";
import {
  emptyCapabilityOverrides,
  type CapabilityConfiguration,
  type CapabilityPatch,
} from "@nervekit/contracts/capabilities";
import type { Project } from "@nervekit/contracts/core";
import type { ProjectHarnessOverrides } from "@nervekit/contracts/settings";
import {
  readAgentProfiles,
  resetAgentProfile,
} from "$lib/features/settings/api/agent-profiles.api";
import {
  readProjectSettings,
  updateProjectSettings,
} from "$lib/features/settings/api/project-settings.api";
import {
  harnessResetPatch,
  projectPageDiffs,
  skillsResetPatch,
  toolsResetPatch,
} from "./project-diff";
import type { LaunchDefinitionCatalog } from "@nervekit/contracts/launch-definitions";
import {
  deleteLaunchDefinition,
  getLaunchCatalog,
} from "$lib/features/launches";
import { requestWorkbench } from "$lib/application/startup/workbench-connection";
import type { InstructionsFile } from "$lib/features/settings/views/pages/project/InstructionsFilesPage.svelte";
import type { LaunchDefinitionRow } from "$lib/features/settings/views/pages/project/LaunchSettingsPage.svelte";
import type { TrustEntry } from "$lib/features/settings/views/pages/project/TrustSettingsPage.svelte";
import type { SettingsScopeTarget } from "$lib/features/settings/registry/settings-scope";
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
import { PermissionsPageController } from "$lib/features/settings/views/pages/permissions/permissions-page-state.svelte";
import { StoragePageController } from "$lib/features/settings/views/pages/storage/storage-page-state.svelte";
export function createSettingsPageControllers(deps: {
  /** The immutable target of the view these controllers serve. */
  target: () => SettingsScopeTarget;
  /** The target's project, when it is one and is still known. */
  project: () => Project | undefined;
}) {
  const targetProjectId = () => {
    const target = deps.target();
    return target.kind === "project" ? target.projectId : undefined;
  };
  let capabilityConfiguration = $state<CapabilityConfiguration>();
  let capabilityLoading = $state(false);
  let capabilityError = $state<string>();
  let capabilityRequest = 0;

  async function loadProjectCapabilities(): Promise<void> {
    const projectId = targetProjectId();
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

  /** What the project stores outside capabilities; see `pageDiffs`. */
  let harnessOverrides = $state.raw<ProjectHarnessOverrides>();
  let profileFiles = $state.raw<{ name: string; digest: string | null }[]>([]);
  let diffRequest = 0;

  async function loadProjectDiff(): Promise<void> {
    const projectId = targetProjectId();
    const request = ++diffRequest;
    if (!projectId) {
      harnessOverrides = undefined;
      profileFiles = [];
      return;
    }
    try {
      const [settings, profiles] = await Promise.all([
        readProjectSettings(projectId),
        readAgentProfiles({ scope: "project", projectId }),
      ]);
      if (request !== diffRequest) return;
      harnessOverrides = settings.overrides;
      profileFiles = profiles.profiles
        .filter((profile) => profile.local !== null)
        .map((profile) => ({ name: profile.name, digest: profile.digest }));
    } catch {
      // Counts are advisory; the pages report their own load errors.
    }
  }

  let instructionsFiles = $state.raw<InstructionsFile[]>([]);
  let instructionsLoading = $state(false);
  let launchCatalog = $state.raw<LaunchDefinitionCatalog>();
  let instructionsRequest = 0;
  let launchRequest = 0;

  function relativeToProject(path: string): string {
    const root = deps
      .project()
      ?.directory.replaceAll("\\", "/")
      .replace(/\/$/, "");
    const normalized = path.replaceAll("\\", "/");
    return root && normalized.startsWith(`${root}/`)
      ? normalized.slice(root.length + 1)
      : normalized;
  }

  async function loadInstructionsFiles(): Promise<void> {
    const projectId = targetProjectId();
    const request = ++instructionsRequest;
    if (!projectId) {
      instructionsFiles = [];
      return;
    }
    instructionsLoading = true;
    try {
      const { files } = await requestWorkbench("projectInstructions.list", {
        projectId,
      });
      if (request !== instructionsRequest) return;
      instructionsFiles = files.map((file) => ({
        path: relativeToProject(file.path),
        kind: file.path.endsWith("AGENTS.md") ? "agents" : "append",
        description: `Applies to ${relativeToProject(file.appliesTo) || "the project root"}`,
      }));
    } catch {
      if (request === instructionsRequest) instructionsFiles = [];
    } finally {
      if (request === instructionsRequest) instructionsLoading = false;
    }
  }

  async function loadLaunchCatalog(): Promise<void> {
    const projectId = targetProjectId();
    const request = ++launchRequest;
    if (!projectId) {
      launchCatalog = undefined;
      return;
    }
    try {
      const catalog = await getLaunchCatalog(projectId);
      if (request === launchRequest) launchCatalog = catalog;
    } catch {
      // The Launch page shows an empty list; the launches panel reports errors.
    }
  }

  function launchDefinitions(): LaunchDefinitionRow[] {
    return (launchCatalog?.definitions ?? []).map((definition) => ({
      id: definition.id,
      label: definition.label ?? definition.command,
      command: definition.command,
      cwd: definition.cwd,
      port: definition.port,
      runPolicy: definition.runPolicy,
    }));
  }

  async function deleteProjectLaunch(id: string): Promise<void> {
    const projectId = targetProjectId();
    if (!projectId || !launchCatalog) return;
    await deleteLaunchDefinition(projectId, id, launchCatalog.revision);
    await loadLaunchCatalog();
  }

  /** Capabilities and permissions files; profile files list themselves. */
  function trustEntries(): TrustEntry[] {
    const projectId = targetProjectId();
    const capabilities = capabilityConfiguration?.trust;
    const permissions = permissionsController.configuration?.projectTrust;
    return [
      ...(capabilities
        ? [
            {
              id: "capabilities",
              path: ".nerve/config/capabilities.json",
              description: "Tool and skill selections for this project.",
              status: capabilities.status,
              detail:
                "reason" in capabilities ? capabilities.reason : undefined,
              onTrust: () => void setProjectCapabilityTrust(true),
              onRevoke: () => void setProjectCapabilityTrust(false),
            } satisfies TrustEntry,
          ]
        : []),
      ...(permissions && projectId
        ? [
            {
              id: "permissions",
              path: ".nerve/config/permissions.json",
              description: "Permission rule overrides for this project.",
              status: permissions.status,
              detail: "reason" in permissions ? permissions.reason : undefined,
              onTrust: () => void permissionsController.trustProject(projectId),
            } satisfies TrustEntry,
          ]
        : []),
    ];
  }

  $effect(() => {
    const projectId = targetProjectId();
    if (projectId) {
      void loadProjectCapabilities();
      void loadProjectDiff();
      void loadInstructionsFiles();
      void loadLaunchCatalog();
      void permissionsController.load(projectId);
    }
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
    const project = deps.project();
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
    const project = deps.project();
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

  /** Pages where this project differs from the user's settings, with counts. */
  function pageDiffs() {
    return projectPageDiffs({
      harness: harnessOverrides,
      capabilities: capabilityConfiguration?.project,
      profileFiles: profileFiles.length,
    });
  }

  /** Removes every project override on one page, so it follows user settings again. */
  async function resetProjectPage(pageId: string): Promise<void> {
    const projectId = targetProjectId();
    if (!projectId) return;
    const capabilities = capabilityConfiguration?.project;
    switch (pageId) {
      case "general":
        await updateProjectSettings(
          projectId,
          harnessResetPatch(harnessOverrides),
        );
        break;
      case "tools":
        if (capabilities)
          await patchProjectCapabilities(toolsResetPatch(capabilities));
        break;
      case "skills":
        if (capabilities)
          await patchProjectCapabilities(skillsResetPatch(capabilities));
        break;
      case "profiles":
        for (const file of profileFiles)
          await resetAgentProfile({
            scope: "project",
            projectId,
            name: file.name,
            expectedDigest: file.digest,
          });
        break;
    }
    await loadProjectDiff();
  }

  async function setProjectCapabilityTrust(trusted: boolean): Promise<void> {
    const project = deps.project();
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
      targetProjectId()
        ? Promise.all([loadProjectCapabilities(), loadProjectDiff()]).then(
            () => undefined,
          )
        : Promise.resolve();
    const stop = observeConversationChannel({
      recover: refresh,
      disconnected() {},
      event() {},
      notice(notice) {
        if (
          notice.type === "capabilities.changed" &&
          notice.data.projectId === targetProjectId() &&
          !notice.data.conversationId
        )
          void refresh();
      },
    });
    const stopSettings = [
      onEvent("settings.updated", () => void refresh()),
      onEvent("projectSettings.changed", () => void refresh()),
      onEvent("agentProfiles.changed", () => void refresh()),
    ];
    return () => {
      stop();
      for (const unsubscribe of stopSettings) unsubscribe();
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
  const permissionsController = new PermissionsPageController();
  const suggestionsPageState = new SuggestionsPageState();
  function readComposerSelection(): Settings["lastAgentSelection"] {
    const saved = settingsState.settingsDraft?.lastAgentSelection;
    if (!saved) throw new Error("Settings not loaded");
    const config = activeStore?.snapshot?.config;
    return config
      ? {
          ...saved,
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
    get instructionsFiles() {
      return instructionsFiles;
    },
    get instructionsLoading() {
      return instructionsLoading;
    },
    launchDefinitions,
    deleteProjectLaunch,
    trustEntries,
    pageDiffs,
    resetProjectPage,
    patchProjectCapabilities,
    resetProjectCapabilities,
    setProjectCapabilityTrust,
    suggestionsPageState,
    storageController,
    permissionsController,
    readComposerSelection,
  };
}
export type SettingsPageControllers = ReturnType<
  typeof createSettingsPageControllers
>;
