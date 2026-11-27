import { z } from "zod";
import { defineOperation } from "../../operations/definition.js";
import { backgroundJobSchema } from "./background-jobs.js";

export const backgroundJobsOperationDefinitions = [
  defineOperation(
    "backgroundJobs.list",
    z.object({}).optional(),
    z.object({ jobs: z.array(backgroundJobSchema) }),
    "read",
    ["workbench_server"] as const,
    "operation.backgroundJobs.list",
  ),
  defineOperation(
    "backgroundJobs.runNow",
    z.object({ jobId: z.string().min(1) }),
    z.object({ job: backgroundJobSchema }),
    "mutation",
    ["workbench_server"] as const,
    "operation.backgroundJobs.runNow",
  ),
] as const;
