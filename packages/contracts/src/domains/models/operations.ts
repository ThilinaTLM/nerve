import { modelInfoSchema } from "./models.js";
import { z } from "zod";
import { defineOperation } from "../../operations/definition.js";

const emptyParamsSchema = z.object({}).optional();

export const modelsOperationDefinitions = [
  defineOperation(
    "model.list",
    emptyParamsSchema,
    z.object({ models: z.array(modelInfoSchema) }),
    "read",
    "none",
    ["workbench_server"] as const,
    "operation.model.list",
  ),
] as const;
