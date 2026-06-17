import { registerNotificationEventHandlers } from "$lib/features/notifications/state/notification-events";

export function registerFeatureEventHandlers(): () => void {
  const unregister = [registerNotificationEventHandlers()];
  return () => {
    for (const dispose of unregister.splice(0)) dispose();
  };
}
