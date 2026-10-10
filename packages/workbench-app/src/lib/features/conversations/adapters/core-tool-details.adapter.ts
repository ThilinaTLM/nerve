import type { AgentProjection } from "@nervekit/contracts/core";
import type { ToolExecutionResultPayload } from "@nervekit/contracts/tools";
import { requestConversation } from "$lib/application/startup/conversation-connection";
import type {
  ToolCallDetails,
  ToolCallRecord,
  ToolCallResultChunk,
} from "$lib/presentation/view-models/conversation";
import type { ConversationStore } from "../state/core-conversation-store.svelte";
import { retainedConversationStores } from "../state/open-conversation-stores";
import { conversationTranscript } from "./core-transcript.adapter";
import { asyncBashToolView } from "./core-async-bash-tool.adapter";

type LoadedDetails = { details: ToolCallDetails; bytes: Uint8Array };
const cache = new WeakMap<
  ConversationStore,
  Map<string, { signature: string; loading: Promise<LoadedDetails> }>
>();

function agentPreview(
  projection: AgentProjection,
  result: ToolExecutionResultPayload,
): ToolCallRecord["agentPreview"] {
  const images = (result.contentBlocks ?? []).flatMap((block, index) =>
    block.type === "image" ? [{ block, index }] : [],
  );
  const refs = projection.filter((block) => block.type === "image");
  // Projection strategies retain media in source order. Never attach an
  // unrelated result image if that correspondence is unavailable.
  if (
    refs.length !== images.length ||
    refs.some((ref, index) => ref.mimeType !== images[index].block.mimeType)
  )
    return;
  let imageIndex = 0;
  return {
    version: 1,
    blocks: projection.map((block) => {
      if (block.type === "text") return block;
      const image = images[imageIndex++];
      return {
        type: "image" as const,
        mimeType: block.mimeType,
        byteLength: atob(image.block.data).length,
        resultContentBlockIndex: image.index,
      };
    }),
  };
}

async function loadDetails(toolCallId: string): Promise<LoadedDetails> {
  for (const store of retainedConversationStores()) {
    const snapshot = store.snapshot;
    if (!snapshot) continue;
    const events = Object.values(
      Object.fromEntries(
        [...(store.historyEvents ?? []), ...store.events].map((event) => [
          event.id,
          event,
        ]),
      ),
    ).sort((a, b) => a.sequence - b.sequence);
    const record = conversationTranscript({
      snapshot,
      events,
      liveBlocks: store.liveBlocks,
      toolOutput: store.toolOutput,
    }).toolCalls.find((call) => call.id === toolCallId);
    if (!record) continue;
    let entries = cache.get(store);
    if (!entries) {
      entries = new Map();
      cache.set(store, entries);
    }
    const existing = entries.get(toolCallId);
    const signature = `${record.status}:${record.updatedAt}`;
    if (existing?.signature === signature) return existing.loading;
    const response = events.find(
      (event) =>
        event.type === "tool_call_response" &&
        event.payload.toolCallId === toolCallId,
    );
    const args =
      response?.type === "tool_call_response"
        ? response.payload.arguments
        : snapshot.toolCalls.find((call) => call.id === toolCallId)?.arguments;
    const loading = (async (): Promise<LoadedDetails> => {
      // Running calls have arguments, but no stored result to request yet.
      const loaded = response
        ? await requestConversation("toolCall.getDetails", {
            conversationId: store.conversationId,
            toolCallId,
          })
        : undefined;
      const result = loaded?.result;
      const bytes = new TextEncoder().encode(
        result === undefined ? "" : JSON.stringify(result),
      );
      const base = { ...record };
      delete base.argsPreview;
      delete base.previewOverflow;
      delete base.resultPreview;
      return {
        bytes,
        details: {
          toolCall: {
            ...base,
            args,
            result,
            asyncBashView:
              result && record.status === "completed"
                ? asyncBashToolView(record.toolName, result)
                : undefined,
            agentPreview: loaded
              ? agentPreview(loaded.agentProjection, loaded.result)
              : undefined,
            error:
              record.status === "failed"
                ? (result?.content ?? record.error)
                : record.error,
          },
          completeResult: {
            status: loaded ? "inline" : "unavailable",
            hasResult: Boolean(loaded),
            byteLength: bytes.length,
            mediaType: "application/json",
            encoding: "utf-8",
          },
        },
      };
    })();
    entries.set(toolCallId, { signature, loading });
    void loading.catch(() => {
      if (entries.get(toolCallId)?.loading === loading)
        entries.delete(toolCallId);
    });
    return loading;
  }
  throw new Error("Tool call is outside the loaded conversation history");
}

/** Called by the original details dialog only when the user opens it. */
export async function getToolCallDetails(
  toolCallId: string,
): Promise<ToolCallDetails> {
  return (await loadDetails(toolCallId)).details;
}

export async function readToolCallResult(
  toolCallId: string,
  byteOffset: number,
  byteLimit = 64 * 1024,
): Promise<ToolCallResultChunk> {
  const { details, bytes } = await loadDetails(toolCallId);
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
