import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { AgentToolCall } from "./types.js";

export type AgentToolSuspensionData = {
  toolCallId: string;
  toolName: string;
  reason: string;
  assistantMessage?: AssistantMessage;
  toolCall?: AgentToolCall;
  remainingToolCalls?: AgentToolCall[];
};

export class AgentToolSuspension extends Error {
  readonly kind = "agent_tool_suspension";
  readonly data: AgentToolSuspensionData;

  constructor(data: AgentToolSuspensionData) {
    super(data.reason);
    this.name = "AgentToolSuspension";
    this.data = data;
  }

  withContext(
    patch: Partial<
      Pick<
        AgentToolSuspensionData,
        "assistantMessage" | "toolCall" | "remainingToolCalls"
      >
    >,
  ): AgentToolSuspension {
    return new AgentToolSuspension({ ...this.data, ...patch });
  }
}

export function isAgentToolSuspension(
  value: unknown,
): value is AgentToolSuspension {
  return (
    value instanceof AgentToolSuspension ||
    Boolean(
      value &&
      typeof value === "object" &&
      (value as { kind?: unknown }).kind === "agent_tool_suspension",
    )
  );
}
