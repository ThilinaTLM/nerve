import type { ToolCallRecord } from "$lib/api";
import type { ConversationLiveState } from "$lib/core/types/state-types";
import type { buildConversationTimeline } from "./timeline";

export function toolCall(
  id: string,
  createdAt: string,
  toolName: ToolCallRecord["toolName"] = "read",
  sourceToolCallId?: string,
  overrides: Partial<ToolCallRecord> = {},
): ToolCallRecord {
  return {
    id,
    agentId: "agent_01H00000000000000000000000",
    conversationId: "conv_01H00000000000000000000000",
    projectId: "proj_01H0000000000000000000000",
    toolName,
    sourceToolCallId,
    risk: "read",
    args: {},
    cwd: "/tmp/project",
    status: "completed",
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

export function keys(
  items: ReturnType<typeof buildConversationTimeline>,
): string[] {
  return items.map((item) => item.key);
}

export function liveState(
  overrides: Partial<ConversationLiveState> = {},
): ConversationLiveState {
  return {
    runId: "run_01H00000000000000000000000",
    messages: [],
    toolDrafts: [],
    toolOutputByToolCallId: {},
    ...overrides,
  };
}
