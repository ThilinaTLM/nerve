import { subscriptionUsageSchema } from "./index.js";
import { z } from "zod";
import { defineOperation } from "../protocol/operation-definition.schema.js";

const emptyParamsSchema = z.object({}).optional();

export const usageOperationDefinitions = [
  defineOperation(
    "usage.subscription.get",
    emptyParamsSchema,
    z.object({ usage: z.array(subscriptionUsageSchema) }),
    "read",
    "none",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.usage.subscription.get",
  ),
] as const;
