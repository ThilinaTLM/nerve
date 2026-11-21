import { definePublicEvent } from "../../events/definition.js";
import { backgroundJobsChangedEventSchema } from "./background-jobs.js";

export const backgroundJobsEventDefinitions = [
  definePublicEvent(
    "backgroundJobs.changed",
    backgroundJobsChangedEventSchema,
    {
      allowedSourceRoles: ["workbench_server"] as const,
      delivery: "ephemeral",
      coalescing: { strategy: "latest_by_scope" },
      scope: [],
    },
  ),
];
