import {
  applicationLogPruneRequestSchema,
  applicationLogPruneResponseSchema,
} from "./logs.js";
import { defineOperation } from "../../operations/definition.js";

export const logsOperationDefinitions = [
  defineOperation(
    "applicationLog.prune",
    applicationLogPruneRequestSchema,
    applicationLogPruneResponseSchema,
    "mutation",
    ["workbench_server"] as const,
    "operation.applicationLog.prune",
  ),
] as const;
