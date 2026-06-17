import { onAnyEvent, type WorkbenchEvent } from "$lib/core/events/event-bus";
import { notificationForRuntimeEvent } from "$lib/events/runtime-notifications";
import { notifyNative } from "$lib/features/notifications/notify.svelte";
import { workbenchState } from "$lib/stores/workbench/state.svelte";

let unsubscribe: (() => void) | undefined;

export function registerNotificationEventHandlers(): () => void {
  if (unsubscribe) return unsubscribe;
  unsubscribe = onAnyEvent(maybeShowRuntimeNotification);
  return () => {
    unsubscribe?.();
    unsubscribe = undefined;
  };
}

function maybeShowRuntimeNotification(event: WorkbenchEvent): void {
  if (!isRecentEvent(event)) return;
  const candidate = notificationForRuntimeEvent(event, {
    projects: workbenchState.projects,
    conversations: workbenchState.conversations,
  });
  if (!candidate) return;

  notifyNative(candidate.payload, {
    backgroundOnly: candidate.backgroundOnly,
    kind: candidate.kind,
    tag: candidate.tag,
  });
}

function isRecentEvent(event: WorkbenchEvent): boolean {
  const ts = Date.parse(event.ts);
  return Number.isFinite(ts) && Date.now() - ts < 60_000;
}
