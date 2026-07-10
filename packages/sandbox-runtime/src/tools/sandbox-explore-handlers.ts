import {
  createExploreHandlers,
  type ToolHandlerRegistry,
  ToolValidationError,
} from "@nervekit/agent-tools";
import {
  type SandboxOrchestrationHandlerOptions,
  sandboxOrchestrationIdentity,
} from "./sandbox-orchestration-types.js";

export function createSandboxExploreHandlers(
  options: SandboxOrchestrationHandlerOptions,
): ToolHandlerRegistry {
  return createExploreHandlers({
    run: async (request, value, signal) => {
      const current = sandboxOrchestrationIdentity(value);
      const explore = options.exploreRuntime;
      if (!explore) {
        throw new Error("UNAVAILABLE: explore runtime is not configured");
      }
      current.setCancel?.(() => explore.cancelRun(current.scope));
      if (Array.isArray(request.tasks)) {
        const children = await Promise.all(
          request.tasks.map((item) => {
            const child = item as Record<string, unknown>;
            return explore.execute({
              ...current.scope,
              task: requiredString(child.task, "task"),
              context: request.context,
              label: optionalString(child.label),
              depth: request.depth,
              signal,
            });
          }),
        );
        return {
          content: children.map((child) => child.content).join("\n\n---\n\n"),
          details: { children: children.map((child) => child.details) },
        };
      }
      return explore.execute({
        ...current.scope,
        task: requiredString(request.task, "task"),
        context: request.context,
        label: request.label,
        depth: request.depth,
        signal,
      });
    },
  });
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ToolValidationError(`${name} must be a non-empty string.`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
