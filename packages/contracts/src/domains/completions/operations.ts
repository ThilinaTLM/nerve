import {
  completionItemSchema,
  fileCompletionQuerySchema,
} from "./completion.js";
import { z } from "zod";
import { defineOperation } from "../../operations/definition.js";

import {
  completionSearchRequestSchema,
  completionSearchResponseSchema,
  completionSelectionRequestSchema,
  completionSelectionResponseSchema,
} from "./unified-completion.js";

export const completionsOperationDefinitions = [
  defineOperation(
    "completion.search",
    completionSearchRequestSchema,
    completionSearchResponseSchema,
    "read",
    "none",
    ["workbench_server"] as const,
    "operation.completion.search",
  ),
  defineOperation(
    "completion.select",
    completionSelectionRequestSchema,
    completionSelectionResponseSchema,
    "mutation",
    "none",
    ["workbench_server"] as const,
    "operation.completion.select",
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
