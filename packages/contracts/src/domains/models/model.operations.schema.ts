import { modelInfoSchema } from "./index.js";
import { z } from "zod";
import { defineOperation } from "../protocol/operation-definition.schema.js";

const emptyParamsSchema = z.object({}).optional();

export const modelsOperationDefinitions = [
  defineOperation(
    "model.list",
    emptyParamsSchema,
    z.object({ models: z.array(modelInfoSchema) }),
    "read",
    "none",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.model.list",
  ),
] as const;
