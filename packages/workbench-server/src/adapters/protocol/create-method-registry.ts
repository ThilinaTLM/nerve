import { allOperationDefinitions } from "@nervekit/contracts/operations";
import type { OperationHandlerRegistry } from "@nervekit/protocol/server";
import type { ServerAdapterContexts } from "../../app/bootstrap/create-server-adapter-contexts.js";
import {
  bindWorkbenchMethodHandlerGroup,
  combineWorkbenchMethodHandlerGroups,
  type WorkbenchInvocationContext,
} from "./method-handler-registry.js";
import { agentMethodHandlers } from "./handlers/agent-method-handlers.js";
import { conversationMethodHandlers } from "./handlers/conversation-method-handlers.js";
import { gitMethodHandlers } from "./handlers/git-method-handlers.js";
import { interactionMethodHandlers } from "./handlers/interaction-method-handlers.js";
import { platformMethodHandlers } from "./handlers/platform-method-handlers.js";
import { projectMethodHandlers } from "./handlers/project-method-handlers.js";
import { taskMethodHandlers } from "./handlers/task-method-handlers.js";

export const WORKBENCH_OPERATION_METHODS = allOperationDefinitions()
  .filter((definition) =>
    definition.allowedTargetRoles.includes("workbench_server"),
  )
  .map((definition) => definition.method);

export function bindWorkbenchOperationHandlers(
  contexts: ServerAdapterContexts["protocol"],
  diagnostics: ServerAdapterContexts["protocolAdapter"]["performanceDiagnostics"],
  invocation: WorkbenchInvocationContext = {},
): Partial<OperationHandlerRegistry> {
  return combineWorkbenchMethodHandlerGroups([
    bindWorkbenchMethodHandlerGroup(
      platformMethodHandlers,
      contexts.platform,
      diagnostics,
      invocation,
    ),
    bindWorkbenchMethodHandlerGroup(
      interactionMethodHandlers,
      contexts.interactions,
      diagnostics,
      invocation,
    ),
    bindWorkbenchMethodHandlerGroup(
      conversationMethodHandlers,
      contexts.conversations,
      diagnostics,
      invocation,
    ),
    bindWorkbenchMethodHandlerGroup(
      agentMethodHandlers,
      contexts.agents,
      diagnostics,
      invocation,
    ),
    bindWorkbenchMethodHandlerGroup(
      projectMethodHandlers,
      contexts.projects,
      diagnostics,
      invocation,
    ),
    bindWorkbenchMethodHandlerGroup(
      taskMethodHandlers,
      contexts.tasks,
      diagnostics,
      invocation,
    ),
    bindWorkbenchMethodHandlerGroup(
      gitMethodHandlers,
      contexts.git,
      diagnostics,
      invocation,
    ),
  ]).handlers;
}
