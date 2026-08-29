import {
  applicationLogPruneRequestSchema,
  applicationLogPruneResponseSchema,
} from "./index.js";
import { defineOperation } from "../../operations/definition.js";

export const logsOperationDefinitions = [
  defineOperation(
    "applicationLog.prune",
    applicationLogPruneRequestSchema,
    applicationLogPruneResponseSchema,
    "mutation",
    "recommended",
    ["workbench_server"] as const,
    "operation.applicationLog.prune",
  ),
] as const;
