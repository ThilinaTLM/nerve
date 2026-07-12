import { z } from "zod";
import { definePublicEvent } from "../events/event-definition.schema.js";
import { workerRecordSchema } from "./worker.schema.js";

const workbenchRoles = ["workbench_server"] as const;

export const workerEventDefinitions = [
  definePublicEvent(
    "worker.created",
    z.object({ worker: workerRecordSchema }),
    { allowedSourceRoles: workbenchRoles, scope: ["worker.id"] },
  ),
  definePublicEvent(
    "worker.agent_started",
    z.object({
      workerId: z.string().startsWith("worker_"),
      runId: z.string().startsWith("run_"),
    }),
    {
      allowedSourceRoles: workbenchRoles,
      scope: ["workerId", "runId"],
    },
  ),
];
