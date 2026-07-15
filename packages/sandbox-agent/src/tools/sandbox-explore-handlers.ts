import {
  createExploreHandlers,
  type ToolHandlerRegistry,
  ToolValidationError,
} from "@nervekit/host-runtime/tools";
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
      const children = await Promise.all(
        request.tasks.map((child) =>
          explore.execute({
            ...current.scope,
            task: requiredString(child.task, "task"),
            context: child.context
              ? `${request.context}\n\nTask-specific context:\n${child.context}`
              : request.context,
            label: optionalString(child.label),
            depth: request.depth,
            signal,
          }),
        ),
      );
      return {
        content: children.map((child) => child.content).join("\n\n---\n\n"),
        details: { children: children.map((child) => child.details) },
      };
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
