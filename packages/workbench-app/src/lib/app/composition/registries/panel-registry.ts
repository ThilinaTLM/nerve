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

export type GitWorkbenchPanelProps = {
  gitModel: GitPanelModel;
  gitActions: GitPanelActions;
};

export type LoadedWorkbenchPanel =
  | { propsKind: "none"; component: Component }
  | { propsKind: "git"; component: Component<GitWorkbenchPanelProps> };

export type WorkbenchPanelDescriptor = PanelViewDescriptor &
  (
    | { propsKind: "none"; load: () => Promise<{ default: Component }> }
    | {
        propsKind: "git";
        load: () => Promise<{ default: Component<GitWorkbenchPanelProps> }>;
      }
  );

/**
 * The panel view registry is the authority for what can live in a dock. Ids are
 * persisted in `nerve.layout.v1`; unknown ids are dropped on hydration and new
 * entries join their default dock automatically.
 */
export const panelViewDescriptors = [
  {
    id: "conversations",
    propsKind: "none",
    title: "Conversations",
    icon: MessagesSquare,
    defaultDock: "left",
    defaultOrder: 0,
    hideable: false,
    load: () => import("../panels/ConversationsWorkbenchPanel.svelte"),
  },
  {
    id: "files",
    propsKind: "none",
    title: "Files",
    icon: FolderTree,
    defaultDock: "left",
    defaultOrder: 1,
    load: () => import("../panels/FilesWorkbenchPanel.svelte"),
  },
  {
    id: "git",
    propsKind: "git",
    title: "Git Changes",
    icon: GitBranch,
    defaultDock: "right",
    defaultOrder: 0,
    load: () => import("../panels/GitWorkbenchPanel.svelte"),
  },
  {
    id: "pull-requests",
    propsKind: "git",
    title: "Pull Requests",
    icon: GitPullRequest,
    defaultDock: "right",
    defaultOrder: 1,
    load: () => import("../panels/PullRequestsWorkbenchPanel.svelte"),
  },
  {
    id: "context",
    propsKind: "none",
    title: "Context",
    icon: Info,
    defaultDock: "right",
    defaultOrder: 2,
    load: () => import("../panels/ContextWorkbenchPanel.svelte"),
  },
  {
    id: "tasks",
    propsKind: "none",
    title: "Tasks",
    icon: Terminal,
    defaultDock: "left",
    defaultOrder: 2,
    load: () => import("../panels/TasksWorkbenchPanel.svelte"),
  },
  {
    id: "notes",
    propsKind: "none",
    title: "Scratch Notes",
    icon: NotebookPen,
    defaultDock: "left",
    defaultOrder: 3,
    load: () => import("../panels/NotesWorkbenchPanel.svelte"),
  },
] as const satisfies WorkbenchPanelDescriptor[];

export type PanelViewId = (typeof panelViewDescriptors)[number]["id"];
