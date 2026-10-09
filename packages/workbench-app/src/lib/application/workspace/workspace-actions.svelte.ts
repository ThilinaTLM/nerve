import type { Project, ConversationConfig } from "@nervekit/contracts/core";
import { requestConversation } from "$lib/application/startup/conversation-connection";
import {
  conversationLists,
  recoverConversationLists,
} from "./conversation-lists.svelte";
import { workspaceFeaturePorts } from "./workspace-feature-ports.svelte";
import { projectKey } from "$lib/domain/projects/project-tree";
import {
  createProject,
  getFileCompletions,
  openProjectInEditor,
  openProjectInTerminal,
  type CompletionItem,
  type ProjectEditor,
} from "$lib/api";
import { settingsReadModel } from "$lib/application/preferences/settings-read-model.svelte";
import { resolveNewAgentComposerSelection } from "$lib/application/preferences/agent-selection";
import { parseModelKey } from "$lib/presentation/utils/model";
import { createId } from "@nervekit/contracts";
import { closeCenterTabs } from "./center-tab-actions.svelte";
import { queryClient, queryKeys } from "$lib/platform/query/client";
import { registerWorkspaceCommands } from "./workspace-commands";
import { notify } from "$lib/application/notifications/notify.svelte";
import { selection } from "./selection.svelte";
import {
  workspaceState,
  type CenterTabIdentity,
} from "./workspace-state.svelte";
import { projectForNewConversation } from "./new-conversation-project";
import {
  addCenterTab,
  selectCenterTab,
  setActiveCenterTab,
} from "./center-tabs.svelte";
import {
  applyVisibleSession,
  hydrateWorkspaceTabSessions,
  persistWorkspaceTabSessions,
  removeTabsFromAllSessions,
  saveVisibleProjectSession,
} from "./workspace-tab-sessions";
export type ConversationUpdate = {
  title?: string;
  pinned?: boolean;
  completed?: boolean;
  clearStatus?: boolean;
};
registerWorkspaceCommands({ reload: loadWorkspaceState, selectProject });
export async function openConversation(conversationId: string): Promise<void> {
  const snapshot = await requestConversation("conversation.getSnapshot", {
    conversationId,
  });
  await selectProject(snapshot.conversation.projectId, {
    deferTabActivation: true,
  });
  if (!workspaceState.conversations.some((row) => row.id === conversationId)) {
    const rows = await requestConversation("conversation.list", {
      projectId: snapshot.conversation.projectId,
      parentConversationId: snapshot.conversation.parentConversationId,
    });
    workspaceState.conversations = [
      ...workspaceState.conversations.filter(
        (row) => !rows.some((next) => next.id === row.id),
      ),
      ...rows,
    ];
  }
  addCenterTab({ kind: "conversation", id: conversationId });
  await selectCenterTab({ kind: "conversation", id: conversationId });
}
export async function loadWorkspaceState(): Promise<void> {
  workspaceState.projects = await requestConversation("project.list", {});
  await recoverConversationLists(
    workspaceState.projects.map((project) => project.id),
  );
  workspaceState.conversations = [...conversationLists.values()].flatMap(
    (list) => [...list.roots, ...Object.values(list.children).flat()],
  );
  let desiredTab = hydrateWorkspaceTabSessions(
    {
      projects: workspaceState.projects,
      conversations: workspaceState.conversations,
      tasks: [...workspaceFeaturePorts().tasks.read.tasks],
    },
    { deferActivation: true },
  );
  for (const tab of workspaceState.openCenterTabs) {
    if (
      tab.kind !== "conversation" ||
      workspaceState.conversations.some((row) => row.id === tab.id)
    )
      continue;
    try {
      const { conversation } = await requestConversation(
        "conversation.getSnapshot",
        { conversationId: tab.id },
      );
      const rows = await requestConversation("conversation.list", {
        projectId: conversation.projectId,
        parentConversationId: conversation.parentConversationId,
      });
      workspaceState.conversations = [
        ...workspaceState.conversations.filter(
          (row) => !rows.some((next) => next.id === row.id),
        ),
        ...rows,
      ];
    } catch {
      removeTabsFromAllSessions(
        (candidate) =>
          candidate.kind === "conversation" && candidate.id === tab.id,
      );
    }
  }
  if (
    !workspaceState.projects.some(
      (project) => project.id === workspaceState.selectedProjectId,
    )
  ) {
    workspaceState.selectedProjectId = undefined;
    const project =
      workspaceState.projects.find(
        (row) => projectKey(row) === workspaceState.selectedProjectKey,
      ) ?? workspaceState.projects[0];
    if (project)
      desiredTab = await selectProject(project.id, {
        deferTabActivation: true,
      });
    else {
      workspaceState.selectedProjectKey = undefined;
      selection.projectId = undefined;
      selection.conversationId = undefined;
      setActiveCenterTab(undefined);
    }
  }
  if (desiredTab) await selectCenterTab(desiredTab);
}
export async function completeFiles(query: string): Promise<CompletionItem[]> {
  return getFileCompletions(selection.projectId, query);
}
export async function selectProject(
  projectId: string,
  options: { deferTabActivation?: boolean } = {},
): Promise<CenterTabIdentity | undefined> {
  const project = workspaceState.projects.find(
    (candidate) => candidate.id === projectId,
  );
  if (!project) return;
  const key = projectKey(project);
  if (
    workspaceState.selectedProjectKey === key &&
    workspaceState.selectedProjectId
  ) {
    workspaceState.selectedProjectId = project.id;
    selection.projectId = project.id;
    workspaceState.projectRecency[key] = Date.now();
    persistWorkspaceTabSessions();
    return;
  }
  // During startup the persisted key is hydrated before a concrete project ID.
  // There is no outgoing visible session to save in that state.
  if (workspaceState.selectedProjectId) saveVisibleProjectSession();
  workspaceState.selectedProjectId = project.id;
  workspaceState.selectedProjectKey = key;
  workspaceState.projectRecency[key] = Date.now();
  const session = applyVisibleSession(key, {
    deferActivation: options.deferTabActivation,
  });
  selection.projectId = project.id;
  selection.conversationId = undefined;
  persistWorkspaceTabSessions();
  if (options.deferTabActivation) return session.active;
  if (session.active) await selectCenterTab(session.active);
  else setActiveCenterTab(undefined);
  return session.active;
}

export async function openProjectDirectory(dir: string) {
  try {
    const project =
      projectForNewConversation(workspaceState.projects, dir) ??
      (await createProject(dir));
    await queryClient.invalidateQueries({ queryKey: queryKeys.workspace });
    await loadWorkspaceState();
    const current =
      workspaceState.projects.find(
        (candidate) => projectKey(candidate) === projectKey(project),
      ) ?? project;
    if (
      !workspaceState.projects.some((candidate) => candidate.id === current.id)
    ) {
      workspaceState.projects = [...workspaceState.projects, current];
    }
    await selectProject(current.id);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    workspaceState.error = message;
    notify.error("Could not open project", { description: message });
  }
}

export function newConversation() {
  const activeProject = workspaceState.projects.find(
    (project) => project.id === workspaceState.selectedProjectId,
  );
  if (!activeProject) {
    workspaceState.projectPickerMode = "recent";
    workspaceState.projectPickerOpen = true;
    return;
  }
  void createConversationForProject(activeProject).catch(
    reportConversationCreationError,
  );
}

export function newConversationInProject(
  projectDir: string,
  initialMode?: ConversationConfig["mode"],
) {
  const project = projectForNewConversation(
    workspaceState.projects,
    projectDir,
  );
  if (project) {
    void createConversationForProject(project, initialMode).catch(
      reportConversationCreationError,
    );
    return;
  }
  void createConversationForDirectory(projectDir, initialMode);
}

export async function deleteProjectAndRefresh(projectId: string) {
  await requestConversation("project.delete", { projectId });
  await loadWorkspaceState();
}

export async function updateConversationStateAndRefresh(
  conversationId: string,
  request: ConversationUpdate,
) {
  try {
    await requestConversation("conversation.update", {
      conversationId,
      patch: request,
    });
    await loadWorkspaceState();
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    workspaceState.error = message;
    notify.error("Could not update conversation", { description: message });
  }
}

export async function deleteConversationAndRefresh(conversationId: string) {
  try {
    await requestConversation("conversation.delete", { conversationId });
    removeTabsFromAllSessions(
      (tab) => tab.kind === "conversation" && tab.id === conversationId,
    );
    await closeCenterTabs([{ kind: "conversation", id: conversationId }]);
    await queryClient.invalidateQueries({ queryKey: queryKeys.workspace });
    await loadWorkspaceState();
    notify.success("Conversation removed");
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    workspaceState.error = message;
    notify.error("Could not remove conversation", { description: message });
  }
}

export async function openProjectInEditorAndNotify(
  projectId: string,
  editor: ProjectEditor,
  path?: string,
) {
  try {
    await openProjectInEditor(projectId, editor, path);
    notify.success(
      editor === "vscode"
        ? "Opening project in VS Code"
        : "Opening project in Zed",
    );
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    workspaceState.error = message;
    notify.error(
      editor === "vscode" ? "Could not open VS Code" : "Could not open Zed",
      { description: message },
    );
  }
}

export async function openProjectInTerminalAndNotify(
  projectId: string,
  path?: string,
) {
  try {
    await openProjectInTerminal(projectId, path);
    notify.success("Opening project in Terminal");
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    workspaceState.error = message;
    notify.error("Could not open Terminal", { description: message });
  }
}

function reportConversationCreationError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  workspaceState.error = message;
  notify.error("Could not create conversation", { description: message });
}

async function createConversationForProject(
  project: Project,
  initialMode?: ConversationConfig["mode"],
): Promise<void> {
  workspaceState.error = undefined;
  workspaceState.projectPickerOpen = false;
  await selectProject(project.id, { deferTabActivation: true });
  const settings = settingsReadModel.settingsDraft;
  if (!settings) throw new Error("Settings not loaded");
  const defaults = resolveNewAgentComposerSelection(
    settings,
    settingsReadModel.models,
    settingsReadModel.authProviders,
  );
  const model = parseModelKey(defaults.selectedModelKey);
  if (!model)
    throw new Error(
      "Choose a model in settings before creating a conversation",
    );
  const snapshot = await requestConversation("conversation.create", {
    id: createId("conv"),
    projectId: project.id,
    title: "New Conversation",
    config: {
      model,
      reasoningLevel: defaults.selectedThinkingLevel,
      mode: initialMode ?? defaults.selectedMode,
      permissionRuleSetId: defaults.selectedPermissionRuleSetId,
      systemPrompt: null,
      enabledTools: null,
      enabledSkills: null,
      workingDirectory: project.directory,
    },
  });
  await loadWorkspaceState();
  await openConversation(snapshot.conversation.id);
}

export async function createConversationForDirectory(
  dir: string,
  initialMode?: ConversationConfig["mode"],
) {
  workspaceState.error = undefined;
  try {
    const project =
      projectForNewConversation(workspaceState.projects, dir) ??
      (await createProject(dir));
    workspaceState.projects = [
      project,
      ...workspaceState.projects.filter(
        (candidate) => candidate.id !== project.id,
      ),
    ];
    await createConversationForProject(project, initialMode);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    workspaceState.error = message;
    notify.error("Could not open project", { description: message });
  }
}
