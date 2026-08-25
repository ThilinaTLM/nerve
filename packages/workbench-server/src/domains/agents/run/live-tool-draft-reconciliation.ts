import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ConversationRuntime } from "../../runs/runtime/conversation-runtime.js";
import { toPublicToolCallArgsPreview } from "../../tools/tool-call-transcript-preview.js";
import {
  type AssistantToolCallSnapshot,
  assistantToolCallSnapshots,
} from "./harness-execution-shared.js";

export interface LiveToolDraftState {
  contentIndex: number;
  providerToolCallId?: string;
  toolName?: string;
  ended: boolean;
}

export type LiveToolDraftDiscardReason = "abandoned" | "invalid" | "replaced";

type PublishTransient = (type: string, data: unknown) => Promise<void>;

interface ReconcilerDeps {
  conversationRuntime: ConversationRuntime;
  publish: PublishTransient;
  runId: string;
  getTurnId: () => string | undefined;
  getLiveMessageId: () => string | undefined;
}

/**
 * Reconcile streamed live tool-call drafts against the final assistant message.
 * Drafts that resolve to a final tool call are finished; abandoned/invalid
 * partial drafts are discarded so broken tool calls never hang in the live
 * transcript.
 */
export class LiveToolDraftReconciler {
  constructor(private readonly deps: ReconcilerDeps) {}

  async reconcile(
    message: AssistantMessage,
    drafts: LiveToolDraftState[],
  ): Promise<void> {
    const ordered = [...drafts].sort((a, b) => a.contentIndex - b.contentIndex);
    const terminalDiscardReason =
      message.stopReason === "error"
        ? "invalid"
        : message.stopReason === "aborted"
          ? "abandoned"
          : undefined;
    if (terminalDiscardReason) {
      for (const draft of ordered) {
        await this.discard(draft, terminalDiscardReason);
      }
      return;
    }

    const finalToolCalls = assistantToolCallSnapshots(message);
    const consumedFinalIndexes = new Set<number>();
    for (const draft of ordered) {
      if (draft.ended) continue;
      const matchIndex = finalToolCalls.findIndex(
        (candidate, index) =>
          !consumedFinalIndexes.has(index) &&
          ((draft.providerToolCallId !== undefined &&
            candidate.id === draft.providerToolCallId) ||
            (draft.providerToolCallId === undefined &&
              candidate.contentIndex === draft.contentIndex)),
      );
      if (matchIndex === -1) {
        await this.discard(draft, "abandoned");
        continue;
      }
      consumedFinalIndexes.add(matchIndex);
      await this.finish(draft, finalToolCalls[matchIndex]);
    }
  }

  private async finish(
    draft: LiveToolDraftState,
    finalToolCall: AssistantToolCallSnapshot,
  ): Promise<void> {
    const turnId = this.deps.getTurnId();
    const liveMessageId = this.deps.getLiveMessageId();
    if (!turnId || !liveMessageId) return;
    const providerToolCallId = finalToolCall.id ?? draft.providerToolCallId;
    const toolName = finalToolCall.name ?? draft.toolName;
    if (!providerToolCallId || !toolName) {
      await this.discard(draft, "invalid");
      return;
    }
    const data = this.deps.conversationRuntime.finishToolDraft({
      runId: this.deps.runId,
      turnId,
      liveMessageId,
      contentIndex: draft.contentIndex,
      providerToolCallId,
      toolName,
      args: toPublicToolCallArgsPreview(finalToolCall.arguments),
    });
    await this.deps.publish("conversation.live.tool_draft.done", data);
  }

  private async discard(
    draft: LiveToolDraftState,
    reason: LiveToolDraftDiscardReason,
  ): Promise<void> {
    const turnId = this.deps.getTurnId();
    const liveMessageId = this.deps.getLiveMessageId();
    if (!turnId || !liveMessageId) return;
    const data = this.deps.conversationRuntime.discardToolDraft({
      runId: this.deps.runId,
      turnId,
      liveMessageId,
      contentIndex: draft.contentIndex,
      reason,
    });
    if (!data) return;
    await this.deps.publish("conversation.live.tool_draft.discarded", data);
  }
}
