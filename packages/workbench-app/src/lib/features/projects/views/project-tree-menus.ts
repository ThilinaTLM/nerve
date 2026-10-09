import type { ConversationUpdate } from "$lib/application/workspace/workspace-actions.svelte";
import MessageSquarePlus from "@lucide/svelte/icons/message-square-plus";
import MessageSquareText from "@lucide/svelte/icons/message-square-text";
import Pencil from "@lucide/svelte/icons/pencil";
import Copy from "@lucide/svelte/icons/copy";
import Trash2 from "@lucide/svelte/icons/trash-2";
import Pin from "@lucide/svelte/icons/pin";
import PinOff from "@lucide/svelte/icons/pin-off";
import CircleCheck from "@lucide/svelte/icons/circle-check";
import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
import CircleOff from "@lucide/svelte/icons/circle-off";
import type { ContextMenuItem } from "@nervekit/ui-kit/components/composites/context-menu-list";
import type { ProjectEditor, StatusResponse } from "$lib/api";
import type { ConversationSummary } from "@nervekit/contracts/core";
import type { Project } from "@nervekit/contracts/core";
import { writeClipboardText } from "$lib/platform/clipboard/write-text";
import { shortProjectLabel } from "$lib/domain/projects/project-tree";
import { notify } from "$lib/application/notifications/notify.svelte";
import type { DeleteTarget } from "./project-agent-tree-props";
import type { ConversationActivity } from "$lib/application/workspace/conversation-activity";
import { buildExternalLaunchMenu } from "$lib/presentation/brand/external-launch-menu";

export type ProjectTreeMenuContext = {
  homeDir?: string;
  newConversationShortcut?: string;
  editorAvailability?: StatusResponse["runtime"]["editors"];
  terminalAvailability?: StatusResponse["runtime"]["terminal"];
  conversationCount: (projectId: string) => number;
  maintenanceActive?: boolean;
  onOpenConversation?: (conversationId: string) => void;
  conversationActivity?: (
    conversationId: string,
  ) => ConversationActivity | undefined;
  onUpdateConversationState?: (
    conversationId: string,
    request: ConversationUpdate,
  ) => void;
  onNewConversationInProject?: (projectDir: string) => void;
  onOpenProjectInEditor?: (projectId: string, editor: ProjectEditor) => void;
  onOpenProjectInTerminal?: (projectId: string) => void;
  requestDelete: (target: DeleteTarget) => void;
  requestRename?: (conversation: ConversationSummary) => void;
};

export function countProjectConversations(
  conversations: ConversationSummary[],
  projectId: string,
): number {
  return conversations.filter(
    (conversation) => conversation.projectId === projectId,
  ).length;
}

export function countAgeEligible(
  conversations: ConversationSummary[],
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

export function countCompletedEligible(
  conversations: ConversationSummary[],
  projectId: string,
): number {
  return conversations.filter(
    (conversation) =>
      conversation.projectId === projectId && Boolean(conversation.completedAt),
  ).length;
}

export function countKeepEligible(
  conversations: ConversationSummary[],
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

function projectLaunchMenu(
  project: Project,
  ctx: ProjectTreeMenuContext,
): ContextMenuItem[] {
  return buildExternalLaunchMenu({
    targetKind: "directory",
    editors: ctx.editorAvailability,
    terminal: ctx.terminalAvailability,
    openEditor: (editor) => ctx.onOpenProjectInEditor?.(project.id, editor),
    openTerminal: () => ctx.onOpenProjectInTerminal?.(project.id),
  });
}

export function buildProjectMenu(
  project: Project,
  ctx: ProjectTreeMenuContext,
): ContextMenuItem[] {
  const launchItems = projectLaunchMenu(project, ctx);
  const items: ContextMenuItem[] = [
    {
      label: "New chat",
      icon: MessageSquarePlus,
      shortcut: ctx.newConversationShortcut,
      onSelect: () => ctx.onNewConversationInProject?.(project.directory),
    },
  ];
  if (launchItems.length > 0) {
    items.push({ type: "separator" }, ...launchItems);
  }
  items.push(
    { type: "separator" },
    {
      label: "Copy path",
      icon: Copy,
      onSelect: () => void copyToClipboard(project.directory, "path"),
    },
    {
      label: "Remove project",
      icon: Trash2,
      destructive: true,
      disabled: ctx.maintenanceActive,
      onSelect: () =>
        ctx.requestDelete({
          kind: "project",
          id: project.id,
          label: shortProjectLabel(project.directory, ctx.homeDir),
        }),
    },
  );
  return items;
}

export function buildConversationMenu(
  project: Project,
  conversation: ConversationSummary,
  ctx: ProjectTreeMenuContext,
): ContextMenuItem[] {
  const activity = ctx.conversationActivity?.(conversation.id);
  const stateItems: ContextMenuItem[] = [
    {
      label: conversation.pinnedAt ? "Unpin" : "Pin",
      icon: conversation.pinnedAt ? PinOff : Pin,
      onSelect: () =>
        ctx.onUpdateConversationState?.(conversation.id, {
          pinned: !conversation.pinnedAt,
        }),
    },
    {
      label: conversation.completedAt ? "Reopen" : "Mark done",
      icon: conversation.completedAt ? RotateCcw : CircleCheck,
      onSelect: () =>
        ctx.onUpdateConversationState?.(conversation.id, {
          completed: !conversation.completedAt,
        }),
    },
  ];
  if (activity?.clearableFailure) {
    stateItems.push({
      label: "Clear status",
      icon: CircleOff,
      onSelect: () =>
        ctx.onUpdateConversationState?.(conversation.id, {
          clearStatus: true,
        }),
    });
  }
  return [
    {
      label: "Open",
      icon: MessageSquareText,
      onSelect: () => ctx.onOpenConversation?.(conversation.id),
    },
    {
      label: "New chat",
      icon: MessageSquarePlus,
      shortcut: ctx.newConversationShortcut,
      onSelect: () => ctx.onNewConversationInProject?.(project.directory),
    },
    {
      label: "Rename",
      icon: Pencil,
      onSelect: () => ctx.requestRename?.(conversation),
      disabled: !ctx.requestRename,
    },
    { type: "separator" },
    ...stateItems,
    { type: "separator" },
    {
      label: "Copy ID",
      icon: Copy,
      onSelect: () => void copyToClipboard(conversation.id, "conversation id"),
    },
    {
      label: "Delete",
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
