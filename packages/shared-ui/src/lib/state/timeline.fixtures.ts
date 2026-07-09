import type { ToolCallTranscriptRecord } from "@nervekit/shared";
import type { buildConversationTimeline } from "./timeline";
import type { ConversationLiveState } from "./transcript-types";

export function toolCall(
  id: string,
  createdAt: string,
  toolName: ToolCallTranscriptRecord["toolName"] = "read",
  sourceToolCallId?: string,
  overrides: Partial<ToolCallTranscriptRecord> = {},
): ToolCallTranscriptRecord {
  return {
    id,
    agentId: "agent_01H00000000000000000000000",
    conversationId: "conv_01H00000000000000000000000",
    projectId: "proj_01H0000000000000000000000",
    toolName,
    sourceToolCallId,
    risk: "read",
    argsPreview: {},
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
