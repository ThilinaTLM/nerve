import type {
  ToolExecutionContext,
  ToolExecutionResult,
} from "@nervekit/host-runtime/tools";
import type { AgentConfigStore } from "../agent/agent-config-store.js";
import type { ExploreRuntime } from "../agent/explore-runtime.js";
import type { Redactor } from "../security/redaction.js";
import type { PendingInteractionDetail } from "../run/pending-interactions.js";
import type { SandboxPlanReviewStore } from "./plan-review-store.js";
import type { SandboxTaskService } from "./sandbox-task-service.js";
import type { TodoStore } from "./todo-store.js";
import type { ToolRuntimeScope } from "./tool-scope.js";

export type SandboxOrchestrationIdentity = {
  scope: ToolRuntimeScope;
  toolCallId: string;
  context: Partial<ToolExecutionContext>;
  setCancel?: (cancel: () => Promise<void> | void) => void;
};

/**
 * Live bridge to the RunCoordinator interaction model for tool handlers. When
 * present it is the authority: handlers record the pending interaction detail
 * (so the execution adapter can build the durable wait) and read the resolved
 * resolution instead of consulting the retired disk waiters.
 */
export interface SandboxInteractionPort {
  setPending(toolCallId: string, detail: PendingInteractionDetail): void;
  resolved(toolCallId: string): Promise<Record<string, unknown> | undefined>;
}

export type SandboxOrchestrationHandlerOptions = {
  workspaceDir: string;
  redactor?: Redactor;
  interactions?: SandboxInteractionPort;
  planReviewStore?: SandboxPlanReviewStore;
  configStore?: AgentConfigStore;
  taskService?: SandboxTaskService;
  todoStore: TodoStore;
  exploreRuntime?: ExploreRuntime;
  record: (
    entry: Record<string, unknown>,
    context?: Partial<ToolExecutionContext> & Partial<ToolRuntimeScope>,
  ) => Promise<void>;
};

export function sandboxOrchestrationIdentity(
  value: unknown,
): SandboxOrchestrationIdentity {
  if (!value || typeof value !== "object") {
    throw new Error("Sandbox orchestration identity is missing.");
  }
  const identity = value as Partial<SandboxOrchestrationIdentity>;
  if (!identity.scope || typeof identity.toolCallId !== "string") {
    throw new Error("Sandbox orchestration identity is incomplete.");
  }
  return identity as SandboxOrchestrationIdentity;
}

export function taskResult(
  content: string,
  details: unknown,
): ToolExecutionResult {
  return { content, details };
}
