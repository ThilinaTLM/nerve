import { SuggestionsPageState } from "./suggestions/suggestions-page-state.svelte";
import type { ProfileUsableBy } from "@nervekit/contracts/agent-configuration";
import type { Project } from "@nervekit/contracts/core";
import {
  profileFileCount,
  profileKindForPage,
  storedUsableBy,
} from "$lib/features/settings/views/pages/agent-profiles/profile-kind";
import {
  readAgentProfiles,
  resetAgentProfile,
} from "$lib/features/settings/api/agent-profiles.api";
import type {
  LaunchDefinition,
  LaunchDefinitionCatalog,
  UpdateLaunchDefinitionRequest,
} from "@nervekit/contracts/launch-definitions";
import {
  createLaunchDefinition,
  deleteLaunchDefinition,
  getLaunchCatalog,
  updateLaunchDefinition,
} from "$lib/features/launches";
import { notify } from "$lib/application/notifications/notify.svelte";
import { requestWorkbench } from "$lib/application/startup/workbench-connection";
import type { InstructionsFile } from "$lib/features/settings/views/pages/project/InstructionsFilesPage.svelte";
import type { LaunchDefinitionRow } from "$lib/features/settings/views/pages/project/LaunchSettingsPage.svelte";
import type { TrustEntry } from "$lib/features/settings/views/pages/project/TrustSettingsPage.svelte";
import type { SettingsScopeTarget } from "$lib/features/settings/registry/settings-scope";
import { observeConversationChannel } from "$lib/application/startup/conversation-connection";
import { onEvent } from "$lib/application/events/workbench-event-bus";
import { ScopedAgentState } from "$lib/application/agent-configuration/scoped-agent-state.svelte";
import { ScopedExtensionsState } from "$lib/application/extensions/scoped-extensions-state.svelte";
import { refreshPromptSuggestionStatuses } from "$lib/features/prompt-suggestions/state/prompt-suggestions-actions.svelte";
import { promptSuggestionsState } from "$lib/features/prompt-suggestions/state/prompt-suggestions-state.svelte";
import {
  trustPromptSuggestionProjectFile,
  updatePromptSuggestionEnabled,
} from "$lib/features/prompt-suggestions/api/prompt-suggestions.api";
import {
  agentOverridePointers,
  agentOverrideResets,
  differingExtensionCount,
  differingSuggestionCount,
  mergeDiffCounts,
  type AgentOverridePageId,
} from "$lib/features/settings/state/project-page-diffs";
import { PermissionsPageController } from "$lib/features/settings/views/pages/permissions/permissions-page-state.svelte";
import { ExtensionsPageController } from "$lib/features/settings/views/pages/extensions/extensions-page-controller.svelte";
import { StoragePageController } from "$lib/features/settings/views/pages/storage/storage-page-state.svelte";
export function createSettingsPageControllers(deps: {
  /** The immutable target of the view these controllers serve. */
  target: () => SettingsScopeTarget;
  /** The target's project, when it is one and is still known. */
  project: () => Project | undefined;
}) {
  /** The project the unified surface shows: the tab's own, or the open project in a user tab. */
  const targetProjectId = () => {
    const target = deps.target();
    return target.kind === "project" ? target.projectId : deps.project()?.id;
  };
  /** What the project stores outside capabilities; see `pageDiffs`. */
  let profileFiles = $state.raw<
    {
      name: string;
      digest: string;
      usableBy?: ProfileUsableBy;
    }[]
  >([]);
  let diffRequest = 0;
  /** The project's own agent settings, extension entries and suggestion choices. */
  const agentState = new ScopedAgentState();
  const extensionsState = new ScopedExtensionsState();
  /** The suggestions' state is shared with the Suggestions page, which refreshes it. */
  const suggestionStatuses = () => promptSuggestionsState.statuses;
  const suggestionFile = () => promptSuggestionsState.projectFile;

  async function loadProjectDiff(): Promise<void> {
    const projectId = targetProjectId();
    const request = ++diffRequest;
    if (!projectId) {
      profileFiles = [];
      return;
    }
    void agentState.load({ scope: "project", projectId });
    void extensionsState.load({ scope: "project", projectId });
    void refreshPromptSuggestionStatuses(projectId);
    try {
      const profiles = await readAgentProfiles({ scope: "project", projectId });
      if (request !== diffRequest) return;
      profileFiles = profiles.profiles
        .filter((profile) => profile.local)
        .map((profile) => ({
          name: profile.name,
          digest: profile.digest,
          usableBy: storedUsableBy(profile),
        }));
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
    if (root && normalized === root) return "";
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
    try {
      await deleteLaunchDefinition(projectId, id, launchCatalog.revision);
      notify.success("Saved launch deleted");
    } catch (error) {
      notify.error(`Could not delete launch: ${errorText(error)}`);
    } finally {
      await loadLaunchCatalog();
    }
  }

  const errorText = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

  /** The launch dialog of the Launch page: creating, or editing one definition. */
  let launchDialog = $state.raw<
    { kind: "create" } | { kind: "edit"; definition: LaunchDefinition }
  >();
  let launchSaving = $state(false);
  function openLaunchDialog(id?: string): void {
    const definition = id
      ? launchCatalog?.definitions.find((entry) => entry.id === id)
      : undefined;
    launchDialog = definition
      ? { kind: "edit", definition }
      : id
        ? undefined
        : { kind: "create" };
  }
  /** Folders a new launch can go in, in tree order, labelled by their path. */
  function launchFolders(): { id: string; label: string; depth: number }[] {
    const folders = launchCatalog?.folders ?? [];
    const options: { id: string; label: string; depth: number }[] = [];
    const visit = (parent: string | null, path: string[]) => {
      for (const folder of folders
        .filter((entry) => entry.parentFolderId === parent)
        .sort((a, b) => a.order - b.order)) {
        const trail = [...path, folder.label];
        options.push({
          id: folder.id,
          label: trail.join(" / "),
          depth: path.length,
        });
        visit(folder.id, trail);
      }
    };
    visit(null, []);
    return options;
  }
  async function saveLaunchDialog(
    input: UpdateLaunchDefinitionRequest,
    parentFolderId: string | null,
  ): Promise<void> {
    const projectId = targetProjectId();
    const session = launchDialog;
    if (!projectId || !launchCatalog || !session || launchSaving) return;
    launchSaving = true;
    try {
      if (session.kind === "edit")
        await updateLaunchDefinition(
          projectId,
          session.definition.id,
          input,
          launchCatalog.revision,
        );
      else
        await createLaunchDefinition(
          projectId,
          { ...input, parentFolderId, beforeSibling: null },
          launchCatalog.revision,
        );
      notify.success(
        session.kind === "edit" ? "Launch updated" : "Launch saved",
      );
      launchDialog = undefined;
    } catch (error) {
      notify.error(`Could not save launch: ${errorText(error)}`);
    } finally {
      launchSaving = false;
      await loadLaunchCatalog();
    }
  }

  async function decideSuggestionFile(trusted: boolean): Promise<void> {
    const projectId = targetProjectId();
    const file = suggestionFile();
    if (!projectId || !file?.digest) return;
    await trustPromptSuggestionProjectFile({
      projectId,
      expectedDigest: file.digest,
      trusted,
    });
    await refreshPromptSuggestionStatuses(projectId);
  }

  /** Capabilities, permissions and suggestion settings files; profile files list themselves. */
  function trustEntries(): TrustEntry[] {
    const projectId = targetProjectId();
    const permissions = projectPermissions.configuration?.projectTrust;
    return [
      ...(projectId && suggestionFile()
        ? [
            {
              id: "suggestions",
              title: "Prompt suggestion choices",
              path: ".nerve/config/prompt-suggestions.json",
              description:
                "Which prompt suggestions this project turns on or off.",
              status: suggestionFile()!.status,
              onTrust: () => void decideSuggestionFile(true),
              onRevoke: () => void decideSuggestionFile(false),
            } satisfies TrustEntry,
          ]
        : []),
      ...(permissions && projectId
        ? [
            {
              id: "permissions",
              title: "Permission rules",
              path: ".nerve/config/permissions.json",
              description: "Permission rule overrides for this project.",
              status: permissions.status,
              detail: "reason" in permissions ? permissions.reason : undefined,
              onTrust: () => void projectPermissions.trustProject(projectId),
            } satisfies TrustEntry,
          ]
        : []),
    ];
  }

  $effect(() => {
    const projectId = targetProjectId();
    if (projectId) {
      void loadProjectDiff();
      void loadInstructionsFiles();
      void loadLaunchCatalog();
      void projectPermissions.load(projectId);
      // The Permission rules page of a project tab reads its own controller.
      if (deps.target().kind === "project")
        void permissionsController.load(projectId);
    }
  });

  /** Pages where this project differs from the user's settings, with counts. */
  function pageDiffs(): Readonly<Record<string, number>> {
    // A page whose project file is not trusted shows User's values and no differences.
    const agentLocked =
      agentState.document?.status === "available" &&
      agentState.document.trusted === false;
    const overrides = agentState.overrides;
    const agentCounts = Object.fromEntries(
      (["general", "tools", "skills", "sub-agents"] as const).map((page) => [
        page,
        agentLocked ? 0 : agentOverridePointers(overrides, page).length,
      ]),
    );
    return mergeDiffCounts(agentCounts, {
      agents: profileFileCount(profileFiles, "lead"),
      "sub-agents": profileFileCount(profileFiles, "subagent"),
      extensions:
        extensionsState.view?.file.trusted === false
          ? 0
          : differingExtensionCount(
              extensionsState.view,
              extensionsState.inherited,
            ),
      suggestions:
        suggestionFile()?.status === "untrusted"
          ? 0
          : differingSuggestionCount(suggestionStatuses()),
    });
  }

  async function resetAgentOverrides(page: AgentOverridePageId): Promise<void> {
    const resets = agentOverrideResets(agentState.overrides, page);
    if (!resets.length) return;
    await agentState.save({}, resets);
    if (agentState.error) throw new Error(agentState.error);
  }

  /** Removes every project override on one page, so it follows user settings again. */
  async function resetProjectPage(pageId: string): Promise<void> {
    const projectId = targetProjectId();
    if (!projectId) return;
    switch (pageId) {
      case "general":
      case "tools":
      case "skills":
        await resetAgentOverrides(pageId);
        break;
      case "extensions": {
        const ids = (extensionsState.view?.extensions ?? [])
          .filter((entry) => entry.stored)
          .map((entry) => entry.metadata.id);
        await extensionsState.resetAll(ids);
        if (extensionsState.error) throw new Error(extensionsState.error);
        break;
      }
      case "suggestions":
        for (const { definitionKey } of suggestionStatuses().filter(
          (status) => status.projectEnabled !== undefined,
        ))
          await updatePromptSuggestionEnabled({
            definitionKey,
            enabled: null,
            scope: "project",
            projectId,
          });
        break;
      case "agents":
      case "sub-agents":
        if (pageId === "sub-agents") await resetAgentOverrides(pageId);
        for (const file of profileFiles.filter(
          (candidate) =>
            profileFileCount([candidate], profileKindForPage(pageId)) > 0,
        )) {
          const result = await resetAgentProfile({
            scope: { scope: "project", projectId },
            name: file.name,
            expectedDigest: file.digest,
          });
          if (result.status !== "saved")
            throw new Error(
              `Profile reset ${result.status}; reload before retrying.`,
            );
        }
        break;
    }
    await loadProjectDiff();
  }

  $effect(() => {
    const refresh = () =>
      targetProjectId()
        ? Promise.all([loadProjectDiff()]).then(() => undefined)
        : Promise.resolve();
    const stop = observeConversationChannel({
      recover: refresh,
      disconnected() {},
      event() {},
      notice(notice) {
        if (
          notice.type === "agentConfiguration.changed" &&
          notice.data.scope.scope === "project" &&
          notice.data.scope.projectId === targetProjectId()
        )
          void refresh();
      },
    });
    const stopSettings = [
      onEvent("settings.updated", () => void refresh()),
      onEvent("agentProfiles.changed", () => void refresh()),
      onEvent("prompt_suggestions.enabled_updated", () => void refresh()),
      onEvent("launchCatalog.changed", (event) => {
        if (event.data?.projectId === targetProjectId())
          void loadLaunchCatalog();
      }),
    ];
    return () => {
      stop();
      for (const unsubscribe of stopSettings) unsubscribe();
    };
  });
  const storageController = new StoragePageController();
  const permissionsController = new PermissionsPageController();
  /** The project's permission file trust, for the Trust page in any tab. */
  const projectPermissions = new PermissionsPageController();
  const extensionsPageController = new ExtensionsPageController();
  const suggestionsPageState = new SuggestionsPageState();
  return {
    get instructionsFiles() {
      return instructionsFiles;
    },
    get instructionsLoading() {
      return instructionsLoading;
    },
    launchDefinitions,
    deleteProjectLaunch,
    get launchDialog() {
      return launchDialog;
    },
    set launchDialog(value) {
      launchDialog = value;
    },
    get launchSaving() {
      return launchSaving;
    },
    openLaunchDialog,
    launchFolders,
    saveLaunchDialog,
    trustEntries,
    pageDiffs,
    resetProjectPage,
    suggestionsPageState,
    storageController,
    permissionsController,
    extensionsPageController,
  };
}
export type SettingsPageControllers = ReturnType<
  typeof createSettingsPageControllers
>;
