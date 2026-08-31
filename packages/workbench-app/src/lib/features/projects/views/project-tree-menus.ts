import MessageSquarePlus from "@lucide/svelte/icons/message-square-plus";
import MessageSquareText from "@lucide/svelte/icons/message-square-text";
import Copy from "@lucide/svelte/icons/copy";
import Trash2 from "@lucide/svelte/icons/trash-2";
import Pin from "@lucide/svelte/icons/pin";
import PinOff from "@lucide/svelte/icons/pin-off";
import CircleCheck from "@lucide/svelte/icons/circle-check";
import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
import CircleOff from "@lucide/svelte/icons/circle-off";
import type { ContextMenuItem } from "@nervekit/ui-kit/components/composites/context-menu-list";
import type {
  ConversationRecord,
  ProjectEditor,
  ProjectRecord,
  StatusResponse,
  UpdateConversationStateRequest,
} from "$lib/api";
import { writeClipboardText } from "$lib/platform/clipboard/write-text";
import { shortProjectLabel } from "$lib/domain/projects/project-tree";
import { notify } from "$lib/application/notifications/notify.svelte";
import type { DeleteTarget } from "./project-agent-tree-props";
import type { ConversationActivityState } from "$lib/domain/conversations/activity";
import { buildExternalLaunchMenu } from "$lib/presentation/brand/external-launch-menu";

export type ProjectTreeMenuContext = {
  homeDir?: string;
  newConversationShortcut?: string;
  editorAvailability?: StatusResponse["runtime"]["editors"];
  terminalAvailability?: StatusResponse["runtime"]["terminal"];
  conversationCount: (projectId: string) => number;
  onOpenConversation?: (conversationId: string) => void;
  conversationActivity?: (
    conversationId: string,
  ) => ConversationActivityState | undefined;
  onUpdateConversationState?: (
    conversationId: string,
    request: UpdateConversationStateRequest,
  ) => void;
  onNewConversationInProject?: (projectDir: string) => void;
  onOpenProjectInEditor?: (projectId: string, editor: ProjectEditor) => void;
  onOpenProjectInTerminal?: (projectId: string) => void;
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

export function countCompletedEligible(
  conversations: ConversationRecord[],
  projectId: string,
): number {
  return conversations.filter(
    (conversation) =>
      conversation.projectId === projectId && Boolean(conversation.completedAt),
  ).length;
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

function projectLaunchMenu(
  project: ProjectRecord,
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
  project: ProjectRecord,
  ctx: ProjectTreeMenuContext,
): ContextMenuItem[] {
  const launchItems = projectLaunchMenu(project, ctx);
  const items: ContextMenuItem[] = [
    {
      label: "New chat",
      icon: MessageSquarePlus,
      shortcut: ctx.newConversationShortcut,
      onSelect: () => ctx.onNewConversationInProject?.(project.dir),
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
      onSelect: () => void copyToClipboard(project.dir, "path"),
    },
    {
      label: "Clean up conversations",
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
  const activity = ctx.conversationActivity?.(conversation.id);
  const stateItems: ContextMenuItem[] = [
    {
      label: conversation.pinned ? "Unpin" : "Pin",
      icon: conversation.pinned ? PinOff : Pin,
      onSelect: () =>
        ctx.onUpdateConversationState?.(conversation.id, {
          pinned: !conversation.pinned,
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
          clearRuntimeStatus: true,
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
      onSelect: () => ctx.onNewConversationInProject?.(project.dir),
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
