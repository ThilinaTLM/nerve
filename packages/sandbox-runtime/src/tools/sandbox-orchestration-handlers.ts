import type { ToolHandlerRegistry } from "@nervekit/agent-tools";
import { createSandboxExploreHandlers } from "./sandbox-explore-handlers.js";
import { createSandboxInteractionHandlers } from "./sandbox-interaction-handlers.js";
import type { SandboxOrchestrationHandlerOptions } from "./sandbox-orchestration-types.js";
import { createSandboxTaskHandlers } from "./sandbox-task-handlers.js";

export type {
  SandboxOrchestrationHandlerOptions,
  SandboxOrchestrationIdentity,
} from "./sandbox-orchestration-types.js";

export function createSandboxOrchestrationHandlers(
  options: SandboxOrchestrationHandlerOptions,
): ToolHandlerRegistry {
  return {
    ...createSandboxInteractionHandlers(options),
    ...createSandboxTaskHandlers(options),
    ...createSandboxExploreHandlers(options),
  };
}
