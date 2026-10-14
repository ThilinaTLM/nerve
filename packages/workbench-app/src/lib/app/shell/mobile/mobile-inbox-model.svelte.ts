import {
  buildMobileInbox,
  type MobileInboxModel,
} from "$lib/presentation/shell/mobile/mobile-inbox";
import { workspaceSelectors } from "$lib/application/workspace";

export function mobileInboxModel(): MobileInboxModel {
  return buildMobileInbox({
    conversations: workspaceSelectors.conversations,
    activityById: workspaceSelectors.conversationActivityById,
    projectNameById: Object.fromEntries(
      workspaceSelectors.projects.map((project) => [project.id, project.name]),
    ),
  });
}
