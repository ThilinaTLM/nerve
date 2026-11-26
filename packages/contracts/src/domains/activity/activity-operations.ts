import { z } from "zod";
import { defineOperation } from "../../operations/definition.js";
import { activitySchema, activityActionResultSchema } from "./activity.js";
const id = z.object({ activityId: z.string().min(1) });
const empty = z.object({}).optional();
const removed = z.object({ removed: z.number().int().nonnegative() });
export const activityOperationDefinitions = [
  defineOperation(
    "activity.deleteConversation",
    z.object({ conversationIds: z.array(z.string().min(1)).min(1) }),
    removed,
    "mutation",
    ["workbench_server"] as const,
    "operation.activity.deleteConversation",
  ),
  defineOperation(
    "activity.list",
    empty,
    z.object({ activities: z.array(activitySchema) }),
    "read",
    ["workbench_server"] as const,
    "operation.activity.list",
  ),
  defineOperation(
    "activity.cancel",
    id,
    activityActionResultSchema,
    "mutation",
    ["workbench_server"] as const,
    "operation.activity.cancel",
  ),
  defineOperation(
    "activity.retry",
    id,
    activityActionResultSchema,
    "mutation",
    ["workbench_server"] as const,
    "operation.activity.retry",
  ),
  defineOperation(
    "activity.dismiss",
    id,
    removed,
    "mutation",
    ["workbench_server"] as const,
    "operation.activity.dismiss",
  ),
  defineOperation(
    "activity.clear",
    empty,
    removed,
    "mutation",
    ["workbench_server"] as const,
    "operation.activity.clear",
  ),
] as const;
