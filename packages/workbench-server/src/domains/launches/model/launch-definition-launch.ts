import type {
  LaunchPortConflictListener,
  LaunchRecord,
} from "@nervekit/contracts/launches";

export type LaunchDefinitionLaunchOutcome =
  | {
      readonly disposition: "started" | "focused_existing";
      readonly launch: LaunchRecord;
    }
  | {
      readonly disposition: "port_conflict";
      readonly conflict: {
        readonly port: number;
        readonly listeners: LaunchPortConflictListener[];
      };
    };

export async function inspectDefinitionPort(
  guard: LaunchDefinitionPortGuard | undefined,
  port: number | undefined,
  approvedListeners?: readonly LaunchPortConflictListener[],
): Promise<LaunchPortConflictListener[]> {
  if (port === undefined) return [];
  if (!guard) throw new Error("Launch port inspection is unavailable");
  return guard.prepare(port, approvedListeners);
}

export interface LaunchDefinitionPortGuard {
  prepare(
    port: number,
    approvedListeners?: readonly LaunchPortConflictListener[],
  ): Promise<LaunchPortConflictListener[]>;
}
