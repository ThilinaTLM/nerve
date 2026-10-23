import { SuggestionsPageState } from "./suggestions/suggestions-page-state.svelte";
import type { AgentProfileUsableBy } from "@nervekit/contracts/agent-profiles";
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
import { projectPageDiffs } from "./project-diff";
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
import { observeConversationChannel } from "$lib/application/startup/conversation-connection";
import { onEvent } from "$lib/application/events/workbench-event-bus";
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
  /** What the project stores outside capabilities; see `pageDiffs`. */
  let profileFiles = $state.raw<
    {
      name: string;
      digest: string | null;
      usableBy?: AgentProfileUsableBy;
    }[]
  >([]);
  let diffRequest = 0;

  async function loadProjectDiff(): Promise<void> {
    const projectId = targetProjectId();
    const request = ++diffRequest;
    if (!projectId) {
      profileFiles = [];
      return;
    }
    try {
      const profiles = await readAgentProfiles({ scope: "project", projectId });
      if (request !== diffRequest) return;
      profileFiles = profiles.profiles
        .filter((profile) => profile.local !== null)
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
    const permissions = permissionsController.configuration?.projectTrust;
    return [
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
      void loadProjectDiff();
      void loadInstructionsFiles();
      void loadLaunchCatalog();
      void permissionsController.load(projectId);
    }
  });

  /** Pages where this project differs from the user's settings, with counts. */
  function pageDiffs() {
    return projectPageDiffs({
      agentFiles: profileFileCount(profileFiles, "lead"),
      subAgentFiles: profileFileCount(profileFiles, "subagent"),
    });
  }

  /** Removes every project override on one page, so it follows user settings again. */
  async function resetProjectPage(pageId: string): Promise<void> {
    const projectId = targetProjectId();
    if (!projectId) return;
    switch (pageId) {
      case "agents":
      case "sub-agents":
        for (const file of profileFiles.filter(
          (candidate) =>
            profileFileCount([candidate], profileKindForPage(pageId)) > 0,
        ))
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
      onEvent("projectSettings.changed", () => void refresh()),
      onEvent("agentProfiles.changed", () => void refresh()),
    ];
    return () => {
      stop();
      for (const unsubscribe of stopSettings) unsubscribe();
    };
  });
  const storageController = new StoragePageController();
  const permissionsController = new PermissionsPageController();
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
    trustEntries,
    pageDiffs,
    resetProjectPage,
    suggestionsPageState,
    storageController,
    permissionsController,
  };
}
export type SettingsPageControllers = ReturnType<
  typeof createSettingsPageControllers
>;
