import type { ServerAdapterContexts } from "../../../app/bootstrap/create-server-adapter-contexts.js";
import { defineWorkbenchMethodHandlersFor } from "../method-handler-registry.js";
type ActivityContext = ServerAdapterContexts["protocol"]["activity"];
export const activityMethodHandlers =
  defineWorkbenchMethodHandlersFor<ActivityContext>()({
    "activity.list": (context) => ({ activities: context.activities.list() }),
    "activity.cancel": (context, params) =>
      context.activities.cancel(params.activityId),
    "activity.retry": (context, params) =>
      context.activities.retry(params.activityId),
    "activity.dismiss": (context, params) => ({
      removed: context.activities.dismiss(params.activityId),
    }),
    "activity.clear": (context) => ({ removed: context.activities.clear() }),
  });
