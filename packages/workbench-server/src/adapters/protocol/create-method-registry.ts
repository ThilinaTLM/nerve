import type { OperationName } from "@nervekit/contracts/operations";
import {
  createWorkbenchMethodRegistry,
  type WorkbenchMethodRegistry,
  type WorkbenchOperationContext,
} from "./method-handler-registry.js";
import { agentMethodHandlers } from "./handlers/agent-method-handlers.js";
import { conversationMethodHandlers } from "./handlers/conversation-method-handlers.js";
import { gitMethodHandlers } from "./handlers/git-method-handlers.js";
import { interactionMethodHandlers } from "./handlers/interaction-method-handlers.js";
import { platformMethodHandlers } from "./handlers/platform-method-handlers.js";
import { projectMethodHandlers } from "./handlers/project-method-handlers.js";
import { taskMethodHandlers } from "./handlers/task-method-handlers.js";

const registry = createWorkbenchMethodRegistry([
  platformMethodHandlers,
  interactionMethodHandlers,
  conversationMethodHandlers,
  agentMethodHandlers,
  projectMethodHandlers,
  taskMethodHandlers,
  gitMethodHandlers,
]);

export const WORKBENCH_OPERATION_METHODS = registry.methods;

export function handleProtocolMethod(
  state: WorkbenchOperationContext,
  method: OperationName,
  params: unknown,
): Promise<unknown> {
  return registry.handle(state, method, params);
}

export function bindWorkbenchOperationHandlers(
  state: WorkbenchOperationContext,
): ReturnType<WorkbenchMethodRegistry["bind"]> {
  return registry.bind(state);
}
