import ArrowRight from "@lucide/svelte/icons/arrow-right";
import Copy from "@lucide/svelte/icons/copy";
import Plus from "@lucide/svelte/icons/plus";
import Trash2 from "@lucide/svelte/icons/trash-2";
import type { ContextMenuItem } from "@nervekit/ui/components/ui/context-menu-list";
import type {
  ConversationRecord,
  ProjectEditor,
  ProjectRecord,
  StatusResponse,
} from "$lib/api";
import { writeClipboardText } from "$lib/core/clipboard";
import { shortProjectLabel } from "$lib/core/utils/project-tree";
import { notify } from "$lib/features/notifications/notify.svelte";
import type { DeleteTarget } from "./project-agent-tree-props";
import VsCodeIcon from "./VsCodeIcon.svelte";
import ZedIcon from "./ZedIcon.svelte";

export type ProjectTreeMenuContext = {
  homeDir?: string;
  newConversationShortcut?: string;
  editorAvailability?: StatusResponse["runtime"]["editors"];
  conversationCount: (projectId: string) => number;
  onOpenConversation?: (conversationId: string) => void;
  onNewConversationInProject?: (projectDir: string) => void;
  onOpenProjectInEditor?: (projectId: string, editor: ProjectEditor) => void;
  requestPrune: (project: ProjectRecord) => void;
  requestDelete: (target: DeleteTarget) => void;
};

export function countProjectConversations(
  conversations: ConversationRecord[],
  projectId: string,
): number {
  return conversations.filter(
    (conversation) => conversation.projectId === projectId,
  ).length;
}

export function countAgeEligible(
  conversations: ConversationRecord[],
  projectId: string,
  days: number,
): number {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return conversations.filter((conversation) => {
    const updatedAt = Date.parse(conversation.updatedAt);
    return (
      conversation.projectId === projectId &&
      Number.isFinite(updatedAt) &&
      updatedAt < cutoff
    );
  }).length;
}

export function countKeepEligible(
  conversations: ConversationRecord[],
  projectId: string,
  keep: number,
): number {
  return Math.max(
    0,
    countProjectConversations(conversations, projectId) - keep,
  );
}

async function copyToClipboard(text: string, label: string): Promise<void> {
  try {
    await writeClipboardText(text);
    notify.success(`Copied ${label}`);
  } catch {
    notify.error("Could not copy to clipboard");
  }
}

function projectEditorMenu(
  project: ProjectRecord,
  ctx: ProjectTreeMenuContext,
): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];
  if (ctx.editorAvailability?.vscode.available) {
    items.push({
      label: "Open in VS Code",
      icon: VsCodeIcon,
      onSelect: () => ctx.onOpenProjectInEditor?.(project.id, "vscode"),
    });
  }
  if (ctx.editorAvailability?.zed.available) {
    items.push({
      label: "Open in Zed",
      icon: ZedIcon,
      onSelect: () => ctx.onOpenProjectInEditor?.(project.id, "zed"),
    });
  }
  return items;
}

export function buildProjectMenu(
  project: ProjectRecord,
  ctx: ProjectTreeMenuContext,
): ContextMenuItem[] {
  const editorItems = projectEditorMenu(project, ctx);
  const items: ContextMenuItem[] = [
    {
      label: "New chat",
      icon: Plus,
      shortcut: ctx.newConversationShortcut,
      onSelect: () => ctx.onNewConversationInProject?.(project.dir),
    },
  ];
  if (editorItems.length > 0) {
    items.push({ type: "separator" }, ...editorItems);
  }
  items.push(
    { type: "separator" },
    {
      label: "Copy path",
      icon: Copy,
      onSelect: () => void copyToClipboard(project.dir, "path"),
    },
    {
      label: "Clean up",
      icon: Trash2,
      destructive: true,
      disabled: ctx.conversationCount(project.id) === 0,
      onSelect: () => ctx.requestPrune(project),
    },
    {
      label: "Remove project",
      icon: Trash2,
      destructive: true,
      onSelect: () =>
        ctx.requestDelete({
          kind: "project",
          id: project.id,
          label: shortProjectLabel(project.dir, ctx.homeDir),
        }),
    },
  );
  return items;
}

export function buildConversationMenu(
  project: ProjectRecord,
  conversation: ConversationRecord,
  ctx: ProjectTreeMenuContext,
): ContextMenuItem[] {
  return [
    {
      label: "Open conversation",
      icon: ArrowRight,
      onSelect: () => ctx.onOpenConversation?.(conversation.id),
    },
    {
      label: "New chat",
      icon: Plus,
      shortcut: ctx.newConversationShortcut,
      onSelect: () => ctx.onNewConversationInProject?.(project.dir),
    },
    { type: "separator" },
    {
      label: "Copy conversation id",
      icon: Copy,
      onSelect: () => void copyToClipboard(conversation.id, "conversation id"),
    },
    {
      label: "Delete conversation",
      icon: Trash2,
      destructive: true,
      onSelect: () =>
        ctx.requestDelete({
          kind: "conversation",
          id: conversation.id,
          label: conversation.title,
        }),
    },
  ];
}
