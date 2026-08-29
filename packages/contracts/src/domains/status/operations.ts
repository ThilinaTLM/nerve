import { z } from "zod";
import { defineOperation } from "../../operations/definition.js";
import { latestReleaseSchema } from "./status.js";

const emptyParamsSchema = z.object({}).optional();

export const statusOperationDefinitions = [
  defineOperation(
    "status.latestRelease.get",
    emptyParamsSchema,
    latestReleaseSchema,
    "read",
    "none",
    ["workbench_server"] as const,
    "operation.status.latestRelease.get",
  ),
] as const;
