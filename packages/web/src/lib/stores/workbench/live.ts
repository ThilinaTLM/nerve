import type { ConversationActiveRunSnapshot } from "../../api";
import type { ConversationLiveState } from "./state.svelte";

export type ActiveRunLiveOptions = {
  excludeLiveMessageIds?: Iterable<string>;
};

/**
 * Convert an active-run snapshot into the legacy live state used by the
 * transcript renderer. Messages that have already been materialized as
 * persisted entries must be excluded, otherwise snapshot refreshes resurrect
 * stale live blocks and append them at the bottom of the timeline.
 */
export function activeRunToLegacyLive(
  activeRun: ConversationActiveRunSnapshot | undefined,
  options: ActiveRunLiveOptions = {},
): ConversationLiveState {
  if (!activeRun) {
    return { messages: [], toolDrafts: [], toolOutputByToolCallId: {} };
  }

  const excludedLiveMessageIds = new Set(options.excludeLiveMessageIds ?? []);
  const liveTurns = activeRun.turns.map((turn) => ({
    ...turn,
    messages: turn.messages.filter(
      (message) => !excludedLiveMessageIds.has(message.liveMessageId),
    ),
  }));

  const messages = liveTurns.flatMap((turn) =>
    turn.messages.flatMap((message) =>
      message.blocks.flatMap((block) => {
        if (block.kind === "tool_call_draft") return [];
        return [
          {
            id: `live:${message.liveMessageId}:${block.kind}:${block.contentIndex}`,
            role: "assistant" as const,
            displayKind:
              block.kind === "thinking"
                ? ("thinking" as const)
                : ("message" as const),
            text: block.text,
            createdAt: message.startedAt,
            contentIndex: block.contentIndex,
            live: !block.done,
            done: block.done,
            redacted: block.redacted,
          },
        ];
      }),
    ),
  );
  const toolDrafts = liveTurns.flatMap((turn) =>
    turn.messages.flatMap((message) =>
      message.blocks.flatMap((block) => {
        if (block.kind !== "tool_call_draft") return [];
        return [
          {
            kind: "tool_call_draft" as const,
            key: `live:${message.liveMessageId}:tool-draft:${block.contentIndex}`,
            runId: activeRun.runId,
            conversationId: activeRun.conversationId,
            contentIndex: block.contentIndex,
            providerToolCallId: block.providerToolCallId,
            toolName: block.toolName,
            argsText: block.argsText,
            args: block.args,
            done: block.done,
            createdAt: message.startedAt,
            updatedAt: message.startedAt,
          },
        ];
      }),
    ),
  );
  return {
    runId: activeRun.runId,
    messages,
    toolDrafts,
    toolOutputByToolCallId: activeRun.toolOutputsByToolCallId,
  };
}

export function liveTextFromLegacyLive(live: ConversationLiveState): string {
  return live.messages
    .filter((item) => item.displayKind !== "thinking")
    .sort((a, b) => (a.contentIndex ?? 0) - (b.contentIndex ?? 0))
    .map((item) => item.text)
    .join("\n");
}
