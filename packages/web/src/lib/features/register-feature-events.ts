import { registerAuthEventHandlers } from "$lib/features/auth/state/auth-events";
import { registerConversationEventHandlers } from "$lib/features/conversations/state/conversation-events";
import { registerNotificationEventHandlers } from "$lib/features/notifications/state/notification-events";
import { registerSettingsEventHandlers } from "$lib/features/settings/state/settings-events";
import { registerTaskEventHandlers } from "$lib/features/tasks/state/task-events";
import { registerUsageEventHandlers } from "$lib/features/usage/state/usage-events";
import { registerWorkspaceEventHandlers } from "$lib/features/workspace/state/workspace-events";

export function registerFeatureEventHandlers(): () => void {
  const unregister = [
    registerWorkspaceEventHandlers(),
    registerConversationEventHandlers(),
    registerTaskEventHandlers(),
    registerSettingsEventHandlers(),
    registerAuthEventHandlers(),
    registerUsageEventHandlers(),
    registerNotificationEventHandlers(),
  ];
  return () => {
    for (const dispose of unregister.splice(0)) dispose();
  };
}
