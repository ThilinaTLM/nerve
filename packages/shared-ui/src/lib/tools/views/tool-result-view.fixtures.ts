import type {
  ToolCallRecord,
  ToolCallTranscriptRecord,
} from "../../state/tool-types";
import { toolPresentation } from "./tool-presentation";
import { parseToolView } from "./tool-result-view";

export function exploreUpdate(
  phase: string,
  message: string,
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    type: "explore_progress",
    timestamp: "2026-01-01T00:00:00.000Z",
    phase,
    message,
    ...extra,
  });
}

export const CWD = "/tmp/project";

export function toolCall(
  toolName: ToolCallRecord["toolName"],
  args: unknown,
  result: unknown,
  overrides: Partial<ToolCallRecord> = {},
): ToolCallRecord {
  return {
    id: "tool_01H00000000000000000000000",
    agentId: "agent_01H00000000000000000000000",
    conversationId: "conv_01H00000000000000000000000",
    projectId: "proj_01H0000000000000000000000",
    toolName,
    risk: "read",
    args,
    cwd: CWD,
    status: "completed",
    result,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function transcriptToolCall(
  toolName: ToolCallRecord["toolName"],
  argsPreview: unknown,
  resultPreview: unknown,
  overrides: Partial<ToolCallTranscriptRecord> = {},
): ToolCallTranscriptRecord {
  return {
    id: "tool_01H00000000000000000000001",
    agentId: "agent_01H00000000000000000000000",
    conversationId: "conv_01H00000000000000000000000",
    projectId: "proj_01H0000000000000000000000",
    toolName,
    risk: "read",
    argsPreview,
    resultPreview,
    cwd: CWD,
    status: "completed",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function present(
  toolName: ToolCallRecord["toolName"],
  args: unknown,
  result: unknown,
  overrides: Partial<ToolCallRecord> = {},
) {
  const tc = toolCall(toolName, args, result, overrides);
  return toolPresentation(parseToolView(tc), tc);
}

export function presentTranscript(
  toolName: ToolCallRecord["toolName"],
  argsPreview: unknown,
  resultPreview: unknown,
  overrides: Partial<ToolCallTranscriptRecord> = {},
) {
  const tc = transcriptToolCall(
    toolName,
    argsPreview,
    resultPreview,
    overrides,
  );
  return toolPresentation(parseToolView(tc), tc);
}

export function metaText(meta: { text: string }[]): string[] {
  return meta.map((item) => item.text);
}
