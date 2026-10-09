import type {
  ToolCallDetails,
  ToolCallResultChunk,
} from "$lib/presentation/view-models/conversation";
import { retainedConversationStores } from "../state/open-conversation-stores";
import { conversationTranscript } from "./core-transcript.adapter";
export async function getToolCallDetails(
  toolCallId: string,
): Promise<ToolCallDetails> {
  for (const store of retainedConversationStores()) {
    const snapshot = store.snapshot;
    if (!snapshot) continue;
    const record = conversationTranscript({
      snapshot,
      events: store.historyEvents ?? store.events,
      liveBlocks: store.liveBlocks,
      toolOutput: store.toolOutput,
    }).toolCalls.find((call) => call.id === toolCallId);
    if (!record) continue;
    const response = (store.historyEvents ?? store.events).find(
      (e) =>
        e.type === "tool_call_response" && e.payload.toolCallId === toolCallId,
    );
    const result =
      response?.type === "tool_call_response"
        ? response.payload.result
        : undefined;
    const text = result === undefined ? "" : JSON.stringify(result);
    return {
      toolCall: { ...record, args: record.argsPreview, result },
      completeResult: {
        status: result === undefined ? "unavailable" : "inline",
        hasResult: result !== undefined,
        byteLength: new TextEncoder().encode(text).length,
        mediaType: "application/json",
        encoding: "utf-8",
      },
    };
  }
  throw new Error("Tool call is outside the loaded conversation history");
}
export async function readToolCallResult(
  toolCallId: string,
  byteOffset: number,
  byteLimit = 64 * 1024,
): Promise<ToolCallResultChunk> {
  const details = await getToolCallDetails(toolCallId);
  const bytes = new TextEncoder().encode(
    details.toolCall.result === undefined
      ? ""
      : JSON.stringify(details.toolCall.result),
  );
  let end = Math.min(bytes.length, byteOffset + byteLimit);
  while (end > byteOffset && end < bytes.length && (bytes[end] & 0xc0) === 0x80)
    end -= 1;
  if (end === byteOffset && end < bytes.length) {
    end += 1;
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end += 1;
  }
  return {
    status: details.completeResult.status,
    totalBytes: bytes.length,
    byteOffset,
    nextByteOffset: end,
    text: new TextDecoder().decode(bytes.slice(byteOffset, end)),
    done: end >= bytes.length,
  };
}
