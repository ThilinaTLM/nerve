import { registerConversationEventHandlers } from "$lib/features/conversations/state/conversation-events";
import { registerNotificationEventHandlers } from "$lib/features/notifications/state/notification-events";
import { registerProcessEventHandlers } from "$lib/features/processes/state/process-events";
import { registerSettingsEventHandlers } from "$lib/features/settings/state/settings-events";
import { registerUsageEventHandlers } from "$lib/features/usage/state/usage-events";
import { registerWorkspaceEventHandlers } from "$lib/features/workspace/state/workspace-events";

export function registerFeatureEventHandlers(): () => void {
  const unregister = [
    registerWorkspaceEventHandlers(),
    registerConversationEventHandlers(),
    registerProcessEventHandlers(),
    registerSettingsEventHandlers(),
    registerUsageEventHandlers(),
    registerNotificationEventHandlers(),
  ];
  return () => {
    for (const dispose of unregister.splice(0)) dispose();
  };
}
