import {
  completionItemSchema,
  fileCompletionQuerySchema,
} from "./completion.js";
import { z } from "zod";
import { defineOperation } from "../../operations/definition.js";

const emptyParamsSchema = z.object({}).optional();

export const completionsOperationDefinitions = [
  defineOperation(
    "completion.slash.list",
    emptyParamsSchema,
    z.object({ items: z.array(completionItemSchema) }),
    "read",
    "none",
    ["workbench_server"] as const,
    "operation.completion.slash.list",
  ),
  defineOperation(
    "completion.files.list",
    fileCompletionQuerySchema,
    z.object({ items: z.array(completionItemSchema) }),
    "read",
    "none",
    ["workbench_server"] as const,
    "operation.completion.files.list",
  ),
] as const;
