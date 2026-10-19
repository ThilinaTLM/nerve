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
} from "./activity-controller";
export type {
  ActivityStartedInput,
  ActivityStartedObserver,
} from "./activity-controller";
import { toast } from "svelte-sonner";
import { ActivityAttention } from "./activity-attention";
const attention = new ActivityAttention();
const state = $state<{
  activities: Activity[];
  error?: string;
  unseenFailure: boolean;
  open: boolean;
  readIds: Set<string>;
}>({ activities: [], unseenFailure: false, open: false, readIds: new Set() });
let baselined = false;
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
    if (!baselined) {
      // Activities already finished when the app connected are not news.
      baselined = true;
      markRead(
        activities
          .filter((entry) => !isActivityRunning(entry))
          .map((entry) => entry.id),
      );
    }
    state.unseenFailure = attention.update(activities, state.open);
    state.error = undefined;
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
  if (ids.every((id) => state.readIds.has(id))) return;
  state.readIds = new Set([...state.readIds, ...ids]);
}
async function action(
  kind: "cancel" | "retry" | "dismiss",
  activityId: string,
): Promise<void> {
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
