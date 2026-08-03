import FolderTree from "@lucide/svelte/icons/folder-tree";
import GitBranch from "@lucide/svelte/icons/git-branch";
import GitPullRequest from "@lucide/svelte/icons/git-pull-request";
import Info from "@lucide/svelte/icons/info";
import MessagesSquare from "@lucide/svelte/icons/messages-square";
import NotebookPen from "@lucide/svelte/icons/notebook-pen";
import Terminal from "@lucide/svelte/icons/terminal";
import type { PanelViewDescriptor } from "$lib/presentation/shell";

/**
 * The panel view registry is the authority for what can live in a dock. Ids are
 * persisted in `nerve.layout.v1`; unknown ids are dropped on hydration and new
 * entries join their default dock automatically.
 */
export const panelViewDescriptors: PanelViewDescriptor[] = [
  {
    id: "files",
    title: "Files",
    icon: FolderTree,
    defaultDock: "left",
    defaultOrder: 0,
  },
  {
    id: "conversations",
    title: "Conversations",
    icon: MessagesSquare,
    defaultDock: "left",
    defaultOrder: 1,
    hideable: false,
  },
  {
    id: "git",
    title: "Git",
    icon: GitBranch,
    defaultDock: "right",
    defaultOrder: 0,
  },
  {
    id: "pull-requests",
    title: "Pull Requests",
    icon: GitPullRequest,
    defaultDock: "right",
    defaultOrder: 1,
  },
  {
    id: "context",
    title: "Context",
    icon: Info,
    defaultDock: "right",
    defaultOrder: 2,
  },
  {
    id: "notes",
    title: "Notes",
    icon: NotebookPen,
    defaultDock: "right",
    defaultOrder: 3,
  },
  {
    id: "tasks",
    title: "Tasks",
    icon: Terminal,
    defaultDock: "left",
    defaultOrder: 2,
  },
];

export type PanelViewId = (typeof panelViewDescriptors)[number]["id"];
