import type { TaskPortConflictListener, TaskRecord } from "@nervekit/contracts";

export type TaskDefinitionLaunchOutcome =
  | {
      readonly disposition: "started" | "focused_existing";
      readonly task: TaskRecord;
    }
  | {
      readonly disposition: "port_conflict";
      readonly conflict: {
        readonly port: number;
        readonly listeners: TaskPortConflictListener[];
      };
    };

export async function inspectDefinitionPort(
  guard: TaskDefinitionPortGuard | undefined,
  port: number | undefined,
  approvedListeners?: readonly TaskPortConflictListener[],
): Promise<TaskPortConflictListener[]> {
  if (port === undefined) return [];
  if (!guard) throw new Error("Task port inspection is unavailable");
  return guard.prepare(port, approvedListeners);
}

export interface TaskDefinitionPortGuard {
  prepare(
    port: number,
    approvedListeners?: readonly TaskPortConflictListener[],
  ): Promise<TaskPortConflictListener[]>;
}
