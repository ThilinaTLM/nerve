import type { MaintenanceOperation } from "@nervekit/contracts/maintenance";
export type MaintenanceProgressPatch = Partial<
  Pick<
    MaintenanceOperation,
    | "phase"
    | "message"
    | "completedItems"
    | "totalItems"
    | "completedTargets"
    | "totalTargets"
    | "currentTarget"
    | "currentItem"
    | "removedConversationCount"
    | "removedTaskCount"
    | "skippedActiveAgentCount"
    | "skippedActiveTaskCount"
    | "freedBytes"
    | "result"
    | "warnings"
    | "cancellable"
  >
>;
export interface MaintenanceExecution {
  operationId: string;
  cancelled(): boolean;
  report(patch: MaintenanceProgressPatch): Promise<void>;
}
