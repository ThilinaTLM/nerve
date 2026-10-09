import type {
  ConversationEvent,
  ConversationSnapshot,
} from "@nervekit/contracts/core";
import type { LiveAssistantBlock } from "../state/core-conversation-store.svelte";

import type {
  CoreToolCard,
  CoreTimelineRow,
} from "$lib/presentation/state/transcript-types";
export type {
  CoreToolCard,
  CoreTimelineRow,
} from "$lib/presentation/state/transcript-types";

const labels: Record<CoreToolCard["state"], string> = {
  drafting: "Drafting arguments",
  supervising: "Checking permission",
  awaiting_approval: "Awaiting approval",
  ready: "Ready",
  running: "Running",
  awaiting_input: "Awaiting input",
  completed: "Completed",
  failed: "Failed",
  denied: "Denied",
  cancelled: "Cancelled",
  indeterminate: "Outcome unknown",
};

export function conversationTranscript(input: {
  snapshot: ConversationSnapshot;
  events: readonly ConversationEvent[];
  liveBlocks: readonly LiveAssistantBlock[];
  toolOutput: Readonly<Record<string, string>>;
}): CoreTimelineRow[] {
  const { snapshot, events, liveBlocks, toolOutput } = input;
  const rows: CoreTimelineRow[] = [];
  const latestExecutionBoundary = events.findLast(
    (event) =>
      event.type === "system_event" &&
      event.payload.subtype === "execution_state" &&
      ["started", "completed", "failed", "cancelled", "interrupted"].includes(
        event.payload.transition,
      ),
  );
  const openBySlot = new Map(
    snapshot.toolCalls.map((call) => [
      `${call.assistantEventId}:${call.contentIndex}`,
      call,
    ]),
  );
  const responseBySlot = new Map<
    string,
    Extract<ConversationEvent, { type: "tool_call_response" }>
  >();
  for (const event of events)
    if (event.type === "tool_call_response" && event.payload.origin === "model")
      responseBySlot.set(
        `${event.payload.assistantEventId}:${event.payload.contentIndex}`,
        event,
      );
  const included = new Set<string>();
  for (const event of events) {
    if (event.type === "user_message") {
      rows.push({
        kind: "message",
        key: event.id,
        item: {
          id: event.id,
          role: "user",
          text: event.payload.originalText,
          previousEventId: event.previousEventId,
          ...(event.payload.text !== event.payload.originalText
            ? { preparedText: event.payload.text }
            : {}),
          createdAt: event.createdAt,
        },
      });
    } else if (event.type === "assistant_message") {
      for (const [index, block] of event.payload.content.entries()) {
        const slot = `${event.id}:${index}`;
        if (block.type === "toolCall") {
          const call = openBySlot.get(slot);
          const response = responseBySlot.get(slot);
          const id = call?.id ?? response?.payload.toolCallId;
          if (id) included.add(id);
          const state = call?.state ?? response?.payload.outcome ?? "drafting";
          rows.push({
            kind: "tool",
            key: `tool:${event.turnId ?? event.id}:${index}`,
            toolCall: {
              id,
              providerCallId: block.id,
              conversationId: event.conversationId,
              turnId: event.turnId ?? undefined,
              contentIndex: index,
              toolName: block.name,
              argsPreview: block.arguments,
              resultPreview: response?.payload.result,
              state,
              statusLabel: labels[state],
              interaction: call?.interaction,
              supervision: call?.supervision ?? response?.payload.supervision,
              createdAt: event.createdAt,
              updatedAt: call?.updatedAt ?? response?.createdAt,
              liveOutput: id ? toolOutput[id] : undefined,
            },
          });
        } else {
          rows.push({
            kind: "message",
            key: `message:${event.turnId ?? event.id}:${index}:${block.type}`,
            item: {
              id: slot,
              role: "assistant",
              text: block.type === "text" ? block.text : block.thinking,
              ...(block.type === "thinking"
                ? { displayKind: "thinking", redacted: block.redacted }
                : {}),
              createdAt: event.createdAt,
              turnId: event.turnId ?? undefined,
              contentIndex: index,
            },
          });
        }
      }
    } else if (event.type === "tool_call_response") {
      if (
        event.payload.origin === "user" ||
        !included.has(event.payload.toolCallId)
      ) {
        included.add(event.payload.toolCallId);
        rows.push({
          kind: "tool",
          key: `tool:${event.payload.toolCallId}`,
          toolCall: {
            id: event.payload.toolCallId,
            conversationId: event.conversationId,
            toolName: event.payload.toolName,
            argsPreview: event.payload.arguments,
            resultPreview: event.payload.result,
            state: event.payload.outcome,
            statusLabel: labels[event.payload.outcome],
            supervision: event.payload.supervision,
            createdAt: event.createdAt,
            updatedAt: event.createdAt,
          },
        });
      }
    } else if (event.type === "compaction") {
      rows.push({
        kind: "compaction",
        key: event.id,
        notice: {
          id: event.id,
          state: "completed",
          summary: event.payload.summary,
          tokensBefore: event.payload.tokensBefore,
          firstKeptEntryId: event.payload.firstKeptEventId ?? undefined,
          createdAt: event.createdAt,
        },
      });
    } else {
      const payload = event.payload;
      if (payload.subtype === "execution_state") {
        if (
          payload.transition === "retrying" ||
          payload.transition === "failed" ||
          payload.transition === "interrupted"
        ) {
          rows.push({
            kind: "run_status",
            key: event.id,
            notice: {
              entryId: event.id,
              conversationId: event.conversationId,
              canContinue:
                snapshot.conversation.status !== "running" &&
                latestExecutionBoundary?.id === event.id &&
                (payload.transition === "failed" ||
                  payload.transition === "interrupted"),
              state: payload.retry?.exhausted
                ? "retry_exhausted"
                : payload.transition,
              attempt: payload.retry?.attempt,
              maxRetries: payload.retry?.maxAttempts,
              delayMs: payload.retry?.delayMs,
              retryAt: payload.retry
                ? new Date(
                    Date.parse(event.createdAt) + payload.retry.delayMs,
                  ).toISOString()
                : undefined,
              errorMessage: payload.failure?.message ?? payload.retry?.error,
              createdAt: event.createdAt,
            },
          });
        }
      } else if (payload.subtype === "async_bash_event") {
        rows.push({
          kind: "task_event",
          key: event.id,
          notice: {
            entryId: event.id,
            conversationId: event.conversationId,
            bashId: payload.bashId,
            event: `async_bash_${payload.status}`,
            status: payload.status,
            exitCode: payload.exitCode ?? undefined,
            output: payload.text,
            createdAt: event.createdAt,
          },
        });
      } else {
        rows.push({
          kind: "system_event",
          key: event.id,
          notice: {
            entryId: event.id,
            kind: payload.subtype,
            text: payload.text,
            ...(payload.subtype === "sub_conversation_event"
              ? { childConversationId: payload.childConversationId }
              : {}),
            createdAt: event.createdAt,
          },
        });
      }
    }
  }
  for (const call of snapshot.toolCalls) {
    if (included.has(call.id)) continue;
    included.add(call.id);
    rows.push({
      kind: "tool",
      key: `tool:${call.id}`,
      toolCall: {
        id: call.id,
        providerCallId: call.providerCallId ?? undefined,
        conversationId: call.conversationId,
        turnId: call.turnId,
        contentIndex: call.contentIndex ?? undefined,
        toolName: call.toolName,
        argsPreview: call.arguments,
        state: call.state,
        statusLabel: labels[call.state],
        interaction: call.interaction,
        supervision: call.supervision,
        updatedAt: call.updatedAt,
        liveOutput: toolOutput[call.id],
      },
    });
  }
  const committedTurns = new Set(
    events
      .filter((event) => event.type === "assistant_message")
      .map((event) => event.turnId),
  );
  for (const block of [...liveBlocks].sort(
    (a, b) => a.contentIndex - b.contentIndex,
  )) {
    if (committedTurns.has(block.turnId)) continue;
    const key = `${block.turnId}:${block.contentIndex}`;
    if (block.toolCall) {
      rows.push({
        kind: "tool",
        key: `tool:${key}`,
        toolCall: {
          conversationId: snapshot.conversation.id,
          turnId: block.turnId,
          contentIndex: block.contentIndex,
          providerCallId: block.toolCall.providerCallId,
          toolName: block.toolCall.name,
          argsPreview: {},
          partialArgsText: block.toolCall.partialArgsText,
          state: "drafting",
          statusLabel: labels.drafting,
        },
      });
    } else {
      if (block.thinking)
        rows.push({
          kind: "message",
          key: `message:${key}:thinking`,
          item: {
            id: `live:${key}:thinking`,
            role: "assistant",
            text: block.thinking,
            displayKind: "thinking",
            live: true,
            turnId: block.turnId,
            contentIndex: block.contentIndex,
          },
        });
      if (block.text)
        rows.push({
          kind: "message",
          key: `message:${key}:text`,
          item: {
            id: `live:${key}:text`,
            role: "assistant",
            text: block.text,
            live: true,
            turnId: block.turnId,
            contentIndex: block.contentIndex,
          },
        });
    }
  }
  return rows.map((row) =>
    row.kind === "tool"
      ? {
          ...row,
          toolCall: { ...row.toolCall, cwd: snapshot.config.workingDirectory },
        }
      : row,
  );
}
