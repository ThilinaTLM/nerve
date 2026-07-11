import {
  applicationLogPruneRequestSchema,
  applicationLogPruneResponseSchema,
} from "./index.js";
import { defineOperation } from "../protocol/operation-definition.schema.js";

export const logsOperationDefinitions = [
  defineOperation(
    "applicationLog.prune",
    applicationLogPruneRequestSchema,
    applicationLogPruneResponseSchema,
    "mutation",
    "recommended",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.applicationLog.prune",
  ),
] as const;
