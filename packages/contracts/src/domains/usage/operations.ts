import { subscriptionUsageSchema } from "./usage.js";
import { z } from "zod";
import { defineOperation } from "../../operations/definition.js";

const emptyParamsSchema = z.object({}).optional();

export const usageOperationDefinitions = [
  defineOperation(
    "usage.subscription.get",
    emptyParamsSchema,
    z.object({ usage: z.array(subscriptionUsageSchema) }),
    "read",
    "none",
    ["workbench_server"] as const,
    "operation.usage.subscription.get",
  ),
] as const;
