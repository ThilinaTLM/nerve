import type {
  MaintenanceOperation,
  MaintenanceCurrentItem,
} from "@nervekit/contracts/maintenance";
import type { PruneProjectConversationsProgress } from "../projects/prune-conversations.service.js";
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
export function pruneProgress(
  execution: MaintenanceExecution,
): PruneProjectConversationsProgress {
  return {
    operationId: execution.operationId,
    shouldCancel: execution.cancelled,
    onDiscovered: (progress) => execution.report(progress),
    onPhase: (phase, message) =>
      execution.report({
        phase,
        message,
        ...(phase === "finalizing" ? { currentItem: undefined } : {}),
      }),
    onConversationRemoved: (completedItems) =>
      execution.report({
        completedItems,
        removedConversationCount: completedItems,
        currentItem: undefined,
      }),
    onCurrentItem: (currentItem: MaintenanceCurrentItem) =>
      execution.report({ currentItem }),
    yieldControl: () => new Promise((resolve) => setImmediate(resolve)),
  };
}
