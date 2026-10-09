import type { ContextMenuItem } from "@nervekit/ui-kit/components/composites/context-menu-list";
import type { ConversationSummary } from "@nervekit/contracts/core";
import {
  buildConversationMenu,
  countProjectConversations,
  type DeleteTarget,
  type ProjectTreeMenuContext,
} from "$lib/features/projects";
import {
  sidebarConversations,
  sidebarProjects,
  sidebarActivity,
  updateConversationStateAndRefresh,
} from "$lib/features/projects";
import { openConversation } from "$lib/application/workspace";
import {
  maintenance,
  newConversationInProject,
  workspaceSelectors,
} from "$lib/application/workspace";

/**
 * Conversation actions for phone lists. The item model is the same one the
 * desktop context menus use, so open / pin / mark done / copy id / delete stay
 * in lockstep across shells; only the presentation differs (bottom sheet).
 */
export const mobileConversationDelete = $state<{ target?: DeleteTarget }>({});

export function mobileConversationMenu(
  conversation: ConversationSummary,
): ContextMenuItem[] {
  const project = workspaceSelectors.projects.find(
    (candidate) => candidate.id === conversation.projectId,
  );
  if (!project) return [];
  const context: ProjectTreeMenuContext = {
    homeDir: workspaceSelectors.status?.storage.userHome,
    conversationCount: (projectId) =>
      countProjectConversations(
        sidebarConversations(workspaceSelectors.conversations),
        projectId,
      ),
    maintenanceActive: maintenance.active,
    conversationActivity: (conversationId) =>
      sidebarActivity(sidebarConversations(workspaceSelectors.conversations))[
        conversationId
      ],
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
  return buildConversationMenu(
    sidebarProjects([project])[0],
    sidebarConversations([conversation])[0],
    context,
  );
}
