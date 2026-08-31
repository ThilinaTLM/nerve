import FolderTree from "@lucide/svelte/icons/folder-tree";
import GitBranch from "@lucide/svelte/icons/git-branch";
import GitPullRequest from "@lucide/svelte/icons/git-pull-request";
import Info from "@lucide/svelte/icons/info";
import MessagesSquare from "@lucide/svelte/icons/messages-square";
import NotebookPen from "@lucide/svelte/icons/notebook-pen";
import Terminal from "@lucide/svelte/icons/terminal";
import type { GitPanelActions, GitPanelModel } from "$lib/features/git";
import type { PanelViewDescriptor } from "$lib/presentation/shell";
import type { Component } from "svelte";

export type WorkbenchPanelProps = {
  gitModel: GitPanelModel;
  gitActions: GitPanelActions;
};

type WorkbenchPanelComponent = Component<WorkbenchPanelProps>;
export type WorkbenchPanelDescriptor = PanelViewDescriptor & {
  load: () => Promise<{ default: WorkbenchPanelComponent }>;
};

function loadPanel(
  loader: () => Promise<unknown>,
): () => Promise<{ default: WorkbenchPanelComponent }> {
  return loader as () => Promise<{ default: WorkbenchPanelComponent }>;
}

/**
 * The panel view registry is the authority for what can live in a dock. Ids are
 * persisted in `nerve.layout.v1`; unknown ids are dropped on hydration and new
 * entries join their default dock automatically.
 */
export const panelViewDescriptors: WorkbenchPanelDescriptor[] = [
  {
    id: "conversations",
    title: "Conversations",
    icon: MessagesSquare,
    defaultDock: "left",
    defaultOrder: 0,
    hideable: false,
    load: loadPanel(
      () => import("../panels/ConversationsWorkbenchPanel.svelte"),
    ),
  },
  {
    id: "files",
    title: "Files",
    icon: FolderTree,
    defaultDock: "left",
    defaultOrder: 1,
    load: loadPanel(() => import("../panels/FilesWorkbenchPanel.svelte")),
  },
  {
    id: "git",
    title: "Git Changes",
    icon: GitBranch,
    defaultDock: "right",
    defaultOrder: 0,
    load: loadPanel(() => import("../panels/GitWorkbenchPanel.svelte")),
  },
  {
    id: "pull-requests",
    title: "Pull Requests",
    icon: GitPullRequest,
    defaultDock: "right",
    defaultOrder: 1,
    load: loadPanel(
      () => import("../panels/PullRequestsWorkbenchPanel.svelte"),
    ),
  },
  {
    id: "context",
    title: "Context",
    icon: Info,
    defaultDock: "right",
    defaultOrder: 2,
    load: loadPanel(() => import("../panels/ContextWorkbenchPanel.svelte")),
  },
  {
    id: "tasks",
    title: "Tasks",
    icon: Terminal,
    defaultDock: "left",
    defaultOrder: 2,
    load: loadPanel(() => import("../panels/TasksWorkbenchPanel.svelte")),
  },
  {
    id: "notes",
    title: "Scratch Notes",
    icon: NotebookPen,
    defaultDock: "left",
    defaultOrder: 3,
    load: loadPanel(() => import("../panels/NotesWorkbenchPanel.svelte")),
  },
];

export type PanelViewId = (typeof panelViewDescriptors)[number]["id"];
