import type {
  ToolExecutionContext,
  ToolExecutionResult,
} from "@nervekit/host-runtime/tools";
import type { AgentConfigStore } from "../agent/agent-config-store.js";
import type { ExploreRuntime } from "../agent/explore-runtime.js";
import type { Redactor } from "../security/redaction.js";
import type { InputWaiter } from "./input-waiter.js";
import type { PlanReviewWaiter } from "./plan-review-waiter.js";
import type { TaskSupervisor } from "./task-supervisor.js";
import type { TodoStore } from "./todo-store.js";
import type { ToolRuntimeScope } from "./tool-scope.js";

export type SandboxOrchestrationIdentity = {
  scope: ToolRuntimeScope;
  toolCallId: string;
  context: Partial<ToolExecutionContext>;
  setCancel?: (cancel: () => Promise<void> | void) => void;
};

export type SandboxOrchestrationHandlerOptions = {
  workspaceDir: string;
  redactor?: Redactor;
  inputWaiter?: InputWaiter;
  planReviewWaiter?: PlanReviewWaiter;
  configStore?: AgentConfigStore;
  taskSupervisor?: TaskSupervisor;
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
