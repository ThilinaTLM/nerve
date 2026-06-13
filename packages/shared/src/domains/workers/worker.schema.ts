import { z } from "zod";

export const workerKindSchema = z.enum(["local"]);
export type WorkerKind = z.infer<typeof workerKindSchema>;

export const workerStatusSchema = z.enum(["online", "offline", "error"]);
export type WorkerStatus = z.infer<typeof workerStatusSchema>;

export const workerRecordSchema = z.object({
  id: z.string().startsWith("worker_"),
  kind: workerKindSchema,
  name: z.string().min(1),
  status: workerStatusSchema,
  capabilities: z
    .array(z.enum(["agent", "process"]))
    .default(["agent", "process"]),
  endpoint: z
    .object({
      pid: z.number().int().positive().optional(),
      host: z.string().optional(),
      port: z.number().int().positive().optional(),
    })
    .optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type WorkerRecord = z.infer<typeof workerRecordSchema>;
