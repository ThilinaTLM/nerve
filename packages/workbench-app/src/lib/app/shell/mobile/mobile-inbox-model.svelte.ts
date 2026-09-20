import {
  buildMobileInbox,
  type MobileInboxModel,
} from "$lib/presentation/shell";
import { workspaceSelectors } from "$lib/application/workspace";

/**
 * Workspace-wide triage model for the phone inbox. Derived on read so the tab
 * badge and the list always agree.
 */
export function mobileInboxModel(): MobileInboxModel {
  const projectNameById: Record<string, string> = {};
  for (const project of workspaceSelectors.projects) {
    projectNameById[project.id] = project.name;
  }
  return buildMobileInbox({
    approvals: workspaceSelectors.approvals,
    userQuestions: workspaceSelectors.userQuestions,
    planReviews: workspaceSelectors.planReviews,
    conversations: workspaceSelectors.conversations,
    activityById: workspaceSelectors.conversationActivityById,
    projectNameById,
  });
}
