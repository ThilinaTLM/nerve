import type {
  ConversationActiveRunSnapshot,
  ConversationLiveContentBlockSnapshot,
  ConversationLiveMessageSnapshot,
  ConversationLiveToolDraftBlockSnapshot,
  ConversationLiveTurnSnapshot,
  ToolCallTranscriptRecord,
} from "@nervekit/contracts";
import type { buildConversationTimeline } from "./timeline";

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

export function activeRun(
  overrides: Partial<ConversationActiveRunSnapshot> = {},
): ConversationActiveRunSnapshot {
  return {
    runId: "run_01H00000000000000000000000",
    agentId: "agent_01H00000000000000000000000",
    projectId: "proj_01H0000000000000000000000",
    conversationId: "conv_01H00000000000000000000000",
    status: "running",
    startedAt: "2026-01-01T00:00:00.000Z",
    turns: [],
    toolOutputsByToolCallId: {},
    queuedPrompts: [],
    ...overrides,
  };
}

export function runTurn(
  turnId: string,
  ordinal: number,
  messages: ConversationLiveMessageSnapshot[],
): ConversationLiveTurnSnapshot {
  return { turnId, ordinal, messages };
}

export function liveMessage(
  liveMessageId: string,
  messageOrdinal: number,
  blocks: ConversationLiveContentBlockSnapshot[],
  startedAt = "2026-01-01T00:00:00.000Z",
): ConversationLiveMessageSnapshot {
  return { liveMessageId, messageOrdinal, startedAt, blocks };
}

export function textBlock(
  kind: "text" | "thinking",
  contentIndex: number,
  text: string,
  done = false,
): ConversationLiveContentBlockSnapshot {
  return {
    kind,
    contentBlockId: `block_${kind}_${contentIndex}`,
    contentIndex,
    text,
    done,
  };
}

export function draftBlock(
  contentIndex: number,
  overrides: Partial<ConversationLiveToolDraftBlockSnapshot> = {},
): ConversationLiveToolDraftBlockSnapshot {
  return {
    kind: "tool_call_draft",
    contentBlockId: `block_draft_${contentIndex}`,
    contentIndex,
    argsText: "",
    done: false,
    ...overrides,
  };
}
