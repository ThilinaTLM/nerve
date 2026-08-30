import { allOperationDefinitions } from "@nervekit/contracts/operations";
import type { OperationHandlerRegistry } from "@nervekit/protocol/server";
import type { ServerAdapterContexts } from "../../app/bootstrap/create-server-adapter-contexts.js";
import {
  bindWorkbenchMethodHandlerGroup,
  combineWorkbenchMethodHandlerGroups,
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
): Partial<OperationHandlerRegistry> {
  return combineWorkbenchMethodHandlerGroups([
    bindWorkbenchMethodHandlerGroup(
      platformMethodHandlers,
      contexts.platform,
      diagnostics,
    ),
    bindWorkbenchMethodHandlerGroup(
      interactionMethodHandlers,
      contexts.interactions,
      diagnostics,
    ),
    bindWorkbenchMethodHandlerGroup(
      conversationMethodHandlers,
      contexts.conversations,
      diagnostics,
    ),
    bindWorkbenchMethodHandlerGroup(
      agentMethodHandlers,
      contexts.agents,
      diagnostics,
    ),
    bindWorkbenchMethodHandlerGroup(
      projectMethodHandlers,
      contexts.projects,
      diagnostics,
    ),
    bindWorkbenchMethodHandlerGroup(
      taskMethodHandlers,
      contexts.tasks,
      diagnostics,
    ),
    bindWorkbenchMethodHandlerGroup(
      gitMethodHandlers,
      contexts.git,
      diagnostics,
    ),
  ]).handlers;
}
