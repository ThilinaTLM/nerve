import type { ToolExecutionContext } from "@nervekit/agent-tools";
import type { ToolCallScope } from "../agent/tool-call-store.js";

export type ToolRuntimeContext = Partial<ToolExecutionContext> & {
  conversationId?: string;
  agentId?: string;
  runId?: string;
};

export type ToolRuntimeScope = {
  conversationId: string;
  agentId: string;
  runId: string;
};

export function toolScope(context: ToolRuntimeContext): ToolRuntimeScope {
  return {
    conversationId: scopeValue(context, "conversationId") ?? "conv_unknown",
    agentId: scopeValue(context, "agentId") ?? "agent_main",
    runId: scopeValue(context, "runId") ?? "run_unknown",
  };
}

export function scopeValue(
  context: Partial<ToolExecutionContext>,
  key: "conversationId" | "agentId" | "runId",
): string | undefined {
  const value = (context as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

export function activeKey(
  scope: ToolCallScope & { toolCallId: string },
): string {
  return `${scope.conversationId}/${scope.agentId}/${scope.runId}/${scope.toolCallId}`;
}
