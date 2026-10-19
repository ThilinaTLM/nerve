import {
  activityUpdatedEventSchema,
  isActivityRunning,
  type Activity,
} from "@nervekit/contracts/activity";
import { protocolRequest } from "$lib/application/startup/workbench-connection";
import { onEvent } from "$lib/application/events/workbench-event-bus";
import {
  ActivityController,
  type ActivityStartedInput,
  type ActivityNoticeInput,
} from "./activity-controller";
export type {
  ActivityStartedInput,
  ActivityStartedObserver,
  ActivityNoticeInput,
} from "./activity-controller";
import { toast } from "svelte-sonner";
import { ActivityAttention } from "./activity-attention";
import { updateActivityReadIds } from "./activity-read-state";
const attention = new ActivityAttention();
const state = $state<{
  activities: Activity[];
  error?: string;
  unseenFailure: boolean;
  open: boolean;
  readIds: Set<string>;
}>({ activities: [], unseenFailure: false, open: false, readIds: new Set() });
const controller = new ActivityController({
  list: async () =>
    (await protocolRequest("activity.list", {})).result.activities,
  subscribe: (handler) =>
    onEvent("activity.updated", (event) => {
      const parsed = activityUpdatedEventSchema.safeParse(event.data);
      if (parsed.success) handler(parsed.data);
    }),
  changed: (activities) => {
    state.activities = activities;
    state.readIds = updateActivityReadIds(state.readIds, activities);
    state.unseenFailure = attention.update(activities, state.open);
    state.error = undefined;
  },
  baseline: (activities) => {
    // Only the first successful daemon snapshot establishes pre-existing work.
    // An empty snapshot counts too; client notices never establish a baseline.
    markRead(
      activities
        .filter((entry) => !isActivityRunning(entry))
        .map((entry) => entry.id),
    );
  },
  error: (error) => {
    state.error =
      error instanceof Error ? error.message : "Could not load activities.";
  },
  failed: (activity) => {
    // Maintenance already announces through its existing Settings controller.
    if (state.open || activity.kind.startsWith("maintenance.")) return;
    toast.error(activity.title, {
      description: activity.error?.message ?? activity.message,
      action: {
        label: "View activity",
        onClick: () => activityInbox.setOpen(true),
      },
    });
  },
});
function markRead(ids: readonly string[]): void {
  state.readIds = updateActivityReadIds(state.readIds, state.activities, ids);
}
async function action(
  kind: "cancel" | "retry" | "dismiss",
  activityId: string,
): Promise<void> {
  if (controller.isClientNotice(activityId)) {
    if (kind === "dismiss") {
      controller.dismissLocal(activityId);
      state.error = undefined;
    } else state.error = "Action unavailable.";
    return;
  }
  // A delayed action for an already replaced/dismissed local notice is local too.
  if (activityId.startsWith("client-notice:")) return;
  try {
    const response = await protocolRequest(`activity.${kind}`, { activityId });
    if ("accepted" in response.result && !response.result.accepted)
      throw new Error(response.result.reason ?? "Action unavailable.");
    if (kind === "dismiss") controller.dismissLocal(activityId);
    state.error = undefined;
  } catch (error) {
    state.error =
      error instanceof Error ? error.message : "Activity action failed.";
  }
}
export const activityInbox = {
  get activities() {
    return state.activities;
  },
  get open() {
    return state.open;
  },
  setOpen: (open: boolean) => {
    state.open = open;
    if (open) activityInbox.opened();
  },
  get error() {
    return state.error;
  },
  get readIds(): ReadonlySet<string> {
    return state.readIds;
  },
  markRead,
  get unseenFailure() {
    return state.unseenFailure;
  },
  notify: (input: ActivityNoticeInput): void => controller.notify(input),
  observeStarted: (input: ActivityStartedInput) =>
    controller.observeStarted(input),
  start: () => controller.start(),
  reconnect: () => controller.refresh(),
  dispose: () => controller.dispose(),
  opened: () => {
    state.unseenFailure = attention.update(state.activities, true);
    void controller.refresh();
  },
  action,
  clear: async () => {
    // Client feedback can always be cleared, even if the daemon is unavailable.
    controller.clearClientNotices();
    if (!state.activities.some((entry) => !isActivityRunning(entry))) {
      state.error = undefined;
      return;
    }
    try {
      await protocolRequest("activity.clear", {});
      controller.clearLocal();
      state.error = undefined;
    } catch (error) {
      state.error =
        error instanceof Error ? error.message : "Could not clear activities.";
    }
  },
};
