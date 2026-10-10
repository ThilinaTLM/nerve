import type {
  CompactionPayload,
  ConversationEvent,
  Usage,
} from "@nervekit/contracts/core";
import type { ThinkingLevel } from "@nervekit/harness/agent";
import type { MessageEntry } from "@nervekit/harness/conversation";
import {
  DEFAULT_AUTO_COMPACTION_SETTINGS,
  deriveAutoCompactionPolicy,
  deriveManualCompactionSettings,
  findCutPoint,
  generateSummary,
  isContextOverflowAssistantMessage,
  shouldAutoCompact,
  type CompactionSettings,
  type ContextUsageEstimate,
  calculateContextTokens,
  estimateRetainedContextTokens,
} from "@nervekit/harness/compaction";
import type { PiModel } from "../ports.js";
import {
  buildModelMessages,
  projectModelMessages,
  selectContextEvents,
  type Message,
  type ProjectionOptions,
} from "./context-projection.js";
import { estimatePathUsage } from "./context-usage.js";

export type { CompactionSettings };
export { isContextOverflowAssistantMessage };

export interface CompactionPreparation {
  firstKeptEventId: string;
  messagesToSummarize: Message[];
  previousSummary?: string;
  tokensBefore: number;
  retainedTokens: number;
  settings: CompactionSettings;
}

/** No writes: plan a suffix while preserving every assistant/result span in event order. */
export function prepareCompaction(
  path: ConversationEvent[],
  settings: CompactionSettings,
  options: ProjectionOptions = {},
): CompactionPreparation | undefined {
  const { compaction, events } = selectContextEvents(path);
  if (!events.length) return undefined;
  const projected = projectModelMessages(events, options);
  if (!projected.length) return undefined;
  const entries: MessageEntry[] = projected.map(
    ({ event, message }, index) => ({
      type: "message",
      id: `${event.id}:${index}`,
      parentId: index ? `${projected[index - 1].event.id}:${index - 1}` : null,
      timestamp: event.createdAt,
      // Planning must keep even interrupted assistant calls with their synthetic
      // results; the harness planner otherwise discards error/aborted proposals.
      message:
        message.role === "assistant" &&
        message.content.some((block) => block.type === "toolCall") &&
        ["error", "aborted"].includes(message.stopReason)
          ? { ...message, stopReason: "toolUse" }
          : message,
    }),
  );
  const plan = findCutPoint(
    entries,
    0,
    entries.length,
    settings.keepRecentTokens,
  );
  if (plan.status !== "ready") return undefined;
  let cut = events.indexOf(projected[plan.firstKeptEntryIndex].event);
  // Responses are projected adjacent to their assistant, but persisted in completion
  // order. A retained response may not leave its assistant in summarized history.
  let previousCut: number;
  do {
    previousCut = cut;
    for (const event of events.slice(cut)) {
      if (
        event.type !== "tool_call_response" ||
        event.payload.origin !== "model"
      )
        continue;
      const assistant = events.findIndex(
        (candidate) => candidate.id === event.payload.assistantEventId,
      );
      if (assistant >= 0 && assistant < cut) cut = assistant;
    }
  } while (cut !== previousCut);
  if (cut <= 0) return undefined;
  const messagesToSummarize = buildModelMessages(events.slice(0, cut), options);
  if (!messagesToSummarize.length) return undefined;
  return {
    firstKeptEventId: events[cut].id,
    messagesToSummarize,
    previousSummary: compaction?.payload.summary,
    tokensBefore: Math.ceil(estimatePathUsage(path, options).tokens),
    retainedTokens: estimateRetainedContextTokens(
      buildModelMessages(events.slice(cut), options),
    ),
    settings,
  };
}

export interface RunCompactionInput extends ProjectionOptions {
  path: ConversationEvent[];
  model: PiModel;
  apiKey?: string;
  headers?: Record<string, string>;
  reasoningLevel?: ThinkingLevel;
  signal?: AbortSignal;
  settings?: CompactionSettings;
}

export async function runCompaction(
  input: RunCompactionInput,
): Promise<CompactionPayload> {
  const settings =
    input.settings ?? deriveManualCompactionSettings(input.model.contextWindow);
  const preparation = prepareCompaction(input.path, settings, input);
  if (!preparation) throw new Error("No safe advancing compaction boundary");
  const summary = await generateSummary({
    messages: preparation.messagesToSummarize,
    previousSummary: preparation.previousSummary,
    model: input.model,
    reserveTokens: settings.reserveTokens,
    apiKey: input.apiKey ?? "",
    headers: input.headers,
    thinkingLevel: input.reasoningLevel,
    signal: input.signal,
  });
  if (!summary.ok) throw summary.error;
  return {
    summary: summary.value,
    firstKeptEventId: preparation.firstKeptEventId,
    tokensBefore: preparation.tokensBefore,
    details: {
      retainedTokens: preparation.retainedTokens,
      retentionBudgetExceeded:
        preparation.retainedTokens > settings.keepRecentTokens,
    },
  };
}

export function shouldCompact(
  usage: number | ContextUsageEstimate | Usage,
  model: PiModel,
): boolean {
  const tokens =
    typeof usage === "number"
      ? usage
      : "tokens" in usage
        ? usage.tokens
        : calculateContextTokens(usage);
  return shouldAutoCompact(
    tokens,
    deriveAutoCompactionPolicy(
      model.contextWindow,
      DEFAULT_AUTO_COMPACTION_SETTINGS,
    ),
  );
}
