import { workerRecordSchema } from "./index.js";
import { z } from "zod";
import { defineOperation } from "../protocol/operation-definition.schema.js";

const emptyParamsSchema = z.object({}).optional();
const workerIdSchema = z.string().startsWith("worker_");
const workerIdParamsSchema = z.object({ workerId: workerIdSchema });

export const workersOperationDefinitions = [
  defineOperation(
    "worker.list",
    emptyParamsSchema,
    z.object({ workers: z.array(workerRecordSchema) }),
    "read",
    "none",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.worker.list",
  ),
  defineOperation(
    "worker.get",
    workerIdParamsSchema,
    z.object({ worker: workerRecordSchema }),
    "read",
    "none",
    ["workbench_server", "sandbox_agent"] as const,
    "operation.worker.get",
  ),
] as const;
