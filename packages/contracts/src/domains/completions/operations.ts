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
] as const;
