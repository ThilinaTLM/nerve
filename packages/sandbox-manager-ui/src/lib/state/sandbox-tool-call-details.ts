import type { ConversationRenderState } from "@nervekit/conversation-ui/state";
import {
  type SandboxToolCallGetResult,
  sandboxToolCallGetResultSchema,
  type ToolCallRecord,
  type ToolCallTranscriptRecord,
} from "@nervekit/shared";
import * as api from "../api/manager-client";

type FetchSandboxToolCall = (
  sandboxId: string,
  params: {
    sandboxId?: string;
    conversationId: string;
    agentId: string;
    runId: string;
    toolCallId: string;
  },
) => Promise<SandboxToolCallGetResult>;

export type ResolveToolCallDetailsOptions = {
  connected?: boolean;
  fetchSandboxToolCall?: FetchSandboxToolCall;
};

/** Resolve a full `ToolCallRecord` for the tool-call details dialog. */
export async function resolveToolCallDetails(
  richState: ConversationRenderState | undefined,
  sandboxId: string,
  toolCallId: string,
  options: ResolveToolCallDetailsOptions = {},
): Promise<ToolCallRecord> {
  const preview = (richState?.toolCalls ?? []).find(
    (call) => call.id === toolCallId,
  );
  if (!preview) {
    throw new Error("Tool call is no longer available in this transcript.");
  }
  const fallback = previewToolCallToRecord(preview);
  if (options.connected === false || !preview.runId) return fallback;

  try {
    const result = await (options.fetchSandboxToolCall ?? defaultFetch)(
      sandboxId,
      {
        sandboxId,
        conversationId: preview.conversationId,
        agentId: preview.agentId,
        runId: preview.runId,
        toolCallId: rawToolCallId(preview),
      },
    );
    return sandboxToolCallGetResultToToolCallRecord(result, preview);
  } catch {
    return fallback;
  }
}

export function sandboxToolCallGetResultToToolCallRecord(
  result: SandboxToolCallGetResult,
  preview: ToolCallTranscriptRecord,
): ToolCallRecord {
  const { argsPreview, resultPreview, previewOverflow, ...base } = preview;
  void previewOverflow;
  const toolCall = result.toolCall;
  return {
    ...base,
    sourceToolCallId: toolCall.toolCallId,
    providerToolCallId: toolCall.toolCallId,
    status: mapSandboxStatus(toolCall.status),
    args: result.argsPreview ?? toolCall.displayArgs ?? argsPreview,
    result: result.resultPreview ?? toolCall.result ?? resultPreview,
    error: toolCall.error?.message ?? preview.error,
    errorDetails: toolCall.error ?? preview.errorDetails,
  };
}

function previewToolCallToRecord(
  preview: ToolCallTranscriptRecord,
): ToolCallRecord {
  const { argsPreview, resultPreview, previewOverflow, ...base } = preview;
  void previewOverflow;
  return {
    ...base,
    args: argsPreview,
    result: resultPreview,
  };
}

async function defaultFetch(
  sandboxId: string,
  params: Parameters<FetchSandboxToolCall>[1],
): Promise<SandboxToolCallGetResult> {
  const key = `cmd_tool_details_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return sandboxToolCallGetResultSchema.parse(
    await api.sendSandboxCommand(
      sandboxId,
      "sandbox.toolCall.get",
      params,
      key,
    ),
  );
}

function rawToolCallId(record: ToolCallTranscriptRecord): string {
  return record.sourceToolCallId ?? record.providerToolCallId ?? record.id;
}

function mapSandboxStatus(
  status: SandboxToolCallGetResult["toolCall"]["status"],
): ToolCallRecord["status"] {
  if (status === "started") return "running";
  if (status === "failed") return "error";
  if (status === "waiting_for_approval") return "pending_approval";
  if (status === "cancelled") return "denied";
  return status;
}
