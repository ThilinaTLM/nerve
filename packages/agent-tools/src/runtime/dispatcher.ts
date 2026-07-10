import type { ToolName } from "@nervekit/contracts";
import { toolManifest } from "../catalog/manifest.js";
import type { ToolDefinition } from "../catalog/types.js";
import type { ToolExecutionContext, ToolExecutionResult } from "../types.js";
import {
  type ToolDecision,
  type ToolHandler,
  type ToolHandlerContext,
  type ToolHandlerRegistry,
  type ToolLifecycleHooks,
  ToolRuntimeError,
  ToolUnavailableError,
} from "./types.js";

export type ToolDispatcherOptions = {
  definitions?: readonly ToolDefinition[];
  advertisedToolNames: ReadonlySet<string>;
  hostHandlers: ToolHandlerRegistry;
  localOverrides?: ToolHandlerRegistry;
  contextFor: (
    name: ToolName,
    args: Record<string, unknown>,
  ) => ToolExecutionContext | Promise<ToolExecutionContext>;
  authorize?: (
    name: ToolName,
    args: Record<string, unknown>,
  ) => ToolDecision | Promise<ToolDecision>;
  lifecycle?: ToolLifecycleHooks;
};

export type ToolDispatcher = {
  execute(
    name: ToolName,
    args: Record<string, unknown>,
    identity?: unknown,
  ): Promise<ToolExecutionResult>;
  assertExecutable(): void;
};

export function createToolDispatcher(
  options: ToolDispatcherOptions,
): ToolDispatcher {
  const definitions = options.definitions ?? toolManifest;
  const byName = new Map(
    definitions.map((definition) => [definition.name, definition]),
  );

  const assertExecutable = () => {
    for (const name of options.advertisedToolNames) {
      const definition = byName.get(name as ToolName);
      if (!definition) throw new ToolUnavailableError(name);
      const handler =
        options.localOverrides?.[definition.name] ??
        options.hostHandlers[definition.name] ??
        (definition.executionKind === "local"
          ? definition.executor
          : undefined);
      if (!handler) {
        throw new ToolRuntimeError(
          "MISSING_TOOL_HANDLER",
          `Advertised tool '${name}' has no executable handler.`,
          { toolName: name },
        );
      }
    }
  };

  assertExecutable();

  return {
    assertExecutable,
    async execute(name, args, identity) {
      const definition = byName.get(name);
      if (!definition || !options.advertisedToolNames.has(name)) {
        throw new ToolUnavailableError(name);
      }
      const prepared = (
        definition.prepareArguments ? definition.prepareArguments(args) : args
      ) as Record<string, unknown>;
      await options.lifecycle?.requested?.(name, prepared);
      const decision = await options.authorize?.(name, prepared);
      if (decision?.decision === "deny") {
        const error = new ToolRuntimeError("TOOL_DENIED", decision.reason, {
          toolName: name,
          risk: decision.risk,
        });
        await options.lifecycle?.failed?.(name, error);
        throw error;
      }
      if (decision?.decision === "approval") {
        const error = new ToolRuntimeError(
          "APPROVAL_REQUIRED",
          decision.reason,
          {
            toolName: name,
            risk: decision.risk,
          },
        );
        await options.lifecycle?.failed?.(name, error);
        throw error;
      }

      const baseContext = await options.contextFor(name, prepared);
      const context: ToolHandlerContext = {
        ...baseContext,
        toolName: name,
        identity,
        onUpdate: (update) => {
          options.lifecycle?.output?.(name, update);
          baseContext.onUpdate?.(update);
        },
      };
      const handler: ToolHandler | undefined =
        options.localOverrides?.[name] ??
        options.hostHandlers[name] ??
        (definition.executionKind === "local"
          ? definition.executor
          : undefined);
      if (!handler) {
        throw new ToolRuntimeError(
          "MISSING_TOOL_HANDLER",
          `Tool '${name}' has no executable handler.`,
          { toolName: name },
        );
      }

      await options.lifecycle?.started?.(name, prepared);
      try {
        const result = await handler(prepared, context);
        await options.lifecycle?.completed?.(name, result);
        return result;
      } catch (error) {
        await options.lifecycle?.failed?.(name, error);
        throw error;
      }
    },
  };
}
