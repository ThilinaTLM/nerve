import type { OperationName } from "@nervekit/contracts";
import type { OrchestratorState } from "../app/orchestrator-state.js";
import {
  createWorkbenchMethodRegistry,
  type WorkbenchMethodRegistry,
} from "./method-handler-registry.js";
import { conversationAgentMethodHandlers } from "./method-handlers/conversation-agent-method-handlers.js";
import { gitMethodHandlers } from "./method-handlers/git-method-handlers.js";
import { interactionMethodHandlers } from "./method-handlers/interaction-method-handlers.js";
import { platformMethodHandlers } from "./method-handlers/platform-method-handlers.js";
import { projectTaskMethodHandlers } from "./method-handlers/project-task-method-handlers.js";

const registry = createWorkbenchMethodRegistry([
  platformMethodHandlers,
  interactionMethodHandlers,
  conversationAgentMethodHandlers,
  projectTaskMethodHandlers,
  gitMethodHandlers,
]);

export const WORKBENCH_OPERATION_METHODS = registry.methods;

export function handleProtocolMethod(
  state: OrchestratorState,
  method: OperationName,
  params: unknown,
): Promise<unknown> {
  return registry.handle(state, method, params);
}

export function bindWorkbenchOperationHandlers(
  state: OrchestratorState,
): ReturnType<WorkbenchMethodRegistry["bind"]> {
  return registry.bind(state);
}
