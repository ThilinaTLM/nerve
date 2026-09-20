import type { ContextMenuItem } from "@nervekit/ui-kit/components/composites/context-menu-list";
import type { ConversationRecord } from "$lib/api";
import {
  buildConversationMenu,
  countProjectConversations,
  type DeleteTarget,
  type ProjectTreeMenuContext,
} from "$lib/features/projects";
import {
  conversationSelectors,
  openConversation,
} from "$lib/features/conversations";
import {
  maintenance,
  newConversationInProject,
  updateConversationStateAndRefresh,
  workspaceSelectors,
} from "$lib/application/workspace";

/**
 * Conversation actions for phone lists. The item model is the same one the
 * desktop context menus use, so open / pin / mark done / copy id / delete stay
 * in lockstep across shells; only the presentation differs (bottom sheet).
 */
export const mobileConversationDelete = $state<{ target?: DeleteTarget }>({});

export function mobileConversationMenu(
  conversation: ConversationRecord,
): ContextMenuItem[] {
  const project = workspaceSelectors.projects.find(
    (candidate) => candidate.id === conversation.projectId,
  );
  if (!project) return [];
  const context: ProjectTreeMenuContext = {
    homeDir: workspaceSelectors.status?.storage.userHome,
    conversationCount: (projectId) =>
      countProjectConversations(workspaceSelectors.conversations, projectId),
    maintenanceActive: maintenance.active,
    conversationActivity: (conversationId) =>
      conversationSelectors.conversationActivityById[conversationId],
    onOpenConversation: (conversationId) =>
      void openConversation(conversationId),
    onNewConversationInProject: newConversationInProject,
    onUpdateConversationState: (conversationId, request) =>
      void updateConversationStateAndRefresh(conversationId, request),
    requestPrune: () => {},
    requestDelete: (target) => {
      mobileConversationDelete.target = target;
    },
  };
  return buildConversationMenu(project, conversation, context);
}
