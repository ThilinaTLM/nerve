import type { AgentHarnessEvent } from "@nervekit/harness";
import {
  PUBLIC_EVENT_MAX_STRING_CHARS,
  type AgentRecord,
  type ConversationActiveRunSnapshot,
} from "@nervekit/contracts";
import type { StreamLogRegistry } from "../../infrastructure/events/index.js";
import { ConversationRuntime } from "../runs/runtime/conversation-runtime.js";
import { assistantContentRedacted } from "./run/harness-execution-shared.js";

type ChildLiveState = {
  parentAgentId: string;
  child: AgentRecord;
  runId: string;
  runtime: ConversationRuntime;
  turnId?: string;
  liveMessageId?: string;
  tail: Promise<void>;
  terminal: boolean;
};

export class SubagentTranscriptLiveService {
  private readonly children = new Map<string, ChildLiveState>();

  constructor(private readonly events: StreamLogRegistry) {}

  async register(input: {
    parentAgentId: string;
    child: AgentRecord;
    runId: string;
  }): Promise<void> {
    const runtime = new ConversationRuntime();
    const run = runtime.startRun({
      conversationId: input.child.conversationId,
      agentId: input.child.id,
      projectId: input.child.projectId,
      runId: input.runId,
    });
    const state: ChildLiveState = {
      ...input,
      runtime,
      tail: Promise.resolve(),
      terminal: false,
    };
    this.children.set(input.child.id, state);
    try {
      await this.publish(state, "agent.subagent_transcript.run.started", {
        startedAt: run.startedAt,
      });
    } catch (error) {
      runtime.failRun(input.runId);
      this.children.delete(input.child.id);
      throw error;
    }
  }

  handleHarnessEvent(
    childAgentId: string,
    event: AgentHarnessEvent,
  ): Promise<void> {
    const state = this.children.get(childAgentId);
    if (!state || state.terminal) return Promise.resolve();
    const work = state.tail.then(() => this.project(state, event));
    state.tail = work.catch(() => undefined);
    return work;
  }

  snapshot(childAgentId: string): ConversationActiveRunSnapshot | undefined {
    const state = this.children.get(childAgentId);
    return state?.runtime.snapshotForConversation(state.child.conversationId);
  }

  async complete(
    childAgentId: string,
    status: "completed" | "failed" | "aborted",
    message?: string,
  ): Promise<void> {
    const state = this.children.get(childAgentId);
    if (!state || state.terminal) return;
    await state.tail;
    state.terminal = true;
    try {
      await this.finishOpenLifecycle(
        state,
        status === "completed" ? "completed" : "failed",
      );
      await this.publish(state, "agent.subagent_transcript.run.completed", {
        status,
        completedAt: new Date().toISOString(),
        message: message?.slice(0, PUBLIC_EVENT_MAX_STRING_CHARS),
      });
    } finally {
      if (status === "completed") state.runtime.completeRun(state.runId);
      else state.runtime.failRun(state.runId);
      this.children.delete(childAgentId);
    }
  }

  private async project(
    state: ChildLiveState,
    event: AgentHarnessEvent,
  ): Promise<void> {
    if (event.type === "turn_start") {
      const turn = state.runtime.startTurn(state.runId);
      state.turnId = turn.turnId;
      state.liveMessageId = undefined;
      await this.publish(state, "agent.subagent_transcript.turn.started", {
        turnId: turn.turnId,
        ordinal: turn.ordinal,
      });
      return;
    }
    if (event.type === "message_start" && event.message.role === "assistant") {
      if (!state.turnId) {
        const turn = state.runtime.startTurn(state.runId);
        state.turnId = turn.turnId;
        await this.publish(state, "agent.subagent_transcript.turn.started", {
          turnId: turn.turnId,
          ordinal: turn.ordinal,
        });
      }
      const message = state.runtime.startAssistantMessage(
        state.runId,
        state.turnId,
      );
      state.liveMessageId = message.liveMessageId;
      await this.publish(state, "agent.subagent_transcript.message.started", {
        turnId: state.turnId,
        liveMessageId: message.liveMessageId,
        messageOrdinal: message.messageOrdinal,
        startedAt: message.startedAt,
      });
      return;
    }
    if (
      event.type === "message_update" &&
      state.turnId &&
      state.liveMessageId
    ) {
      const update = event.assistantMessageEvent;
      if (update.type === "text_delta" || update.type === "thinking_delta") {
        const data = state.runtime.applyContentDelta({
          runId: state.runId,
          turnId: state.turnId,
          liveMessageId: state.liveMessageId,
          contentIndex: update.contentIndex,
          kind: update.type === "text_delta" ? "text" : "thinking",
          delta: update.delta,
        });
        await this.publish(
          state,
          "agent.subagent_transcript.content.delta",
          data,
        );
      } else if (update.type === "text_end" || update.type === "thinking_end") {
        const kind = update.type === "text_end" ? "text" : "thinking";
        const data = state.runtime.finishContent({
          runId: state.runId,
          turnId: state.turnId,
          liveMessageId: state.liveMessageId,
          contentIndex: update.contentIndex,
          kind,
          finalText: update.content,
          redacted:
            kind === "thinking"
              ? assistantContentRedacted(update.partial, update.contentIndex)
              : undefined,
        });
        await this.publish(state, "agent.subagent_transcript.content.done", {
          ...data,
          finalText:
            data.finalText &&
            data.finalText.length <= PUBLIC_EVENT_MAX_STRING_CHARS
              ? data.finalText
              : undefined,
        });
      }
      return;
    }
    if (
      event.type === "message_end" &&
      event.message.role === "assistant" &&
      state.turnId &&
      state.liveMessageId
    ) {
      const failed =
        event.message.stopReason === "error" ||
        event.message.stopReason === "aborted";
      if (failed)
        state.runtime.failAssistantMessage(
          state.runId,
          state.turnId,
          state.liveMessageId,
        );
      else
        state.runtime.completeAssistantMessage(
          state.runId,
          state.turnId,
          state.liveMessageId,
        );
      await this.publish(state, "agent.subagent_transcript.message.completed", {
        turnId: state.turnId,
        liveMessageId: state.liveMessageId,
        status: failed ? "failed" : "completed",
      });
      state.liveMessageId = undefined;
      return;
    }
    if (event.type === "turn_end" && state.turnId) {
      const failed =
        event.message.role === "assistant" &&
        (event.message.stopReason === "error" ||
          event.message.stopReason === "aborted");
      const turnId = state.turnId;
      if (failed) state.runtime.failTurn(state.runId, turnId);
      else state.runtime.completeTurn(state.runId, turnId);
      await this.publish(state, "agent.subagent_transcript.turn.completed", {
        turnId,
        status: failed ? "failed" : "completed",
      });
      state.turnId = undefined;
    }
  }

  private async finishOpenLifecycle(
    state: ChildLiveState,
    status: "completed" | "failed",
  ) {
    if (state.turnId && state.liveMessageId) {
      if (status === "completed")
        state.runtime.completeAssistantMessage(
          state.runId,
          state.turnId,
          state.liveMessageId,
        );
      else
        state.runtime.failAssistantMessage(
          state.runId,
          state.turnId,
          state.liveMessageId,
        );
      await this.publish(state, "agent.subagent_transcript.message.completed", {
        turnId: state.turnId,
        liveMessageId: state.liveMessageId,
        status,
      });
      state.liveMessageId = undefined;
    }
    if (state.turnId) {
      const turnId = state.turnId;
      if (status === "completed")
        state.runtime.completeTurn(state.runId, turnId);
      else state.runtime.failTurn(state.runId, turnId);
      await this.publish(state, "agent.subagent_transcript.turn.completed", {
        turnId,
        status,
      });
      state.turnId = undefined;
    }
  }

  private publish(state: ChildLiveState, type: string, data: object) {
    const payload = { ...(data as Record<string, unknown>) };
    delete payload.conversationId;
    delete payload.projectId;
    delete payload.agentId;
    delete payload.runId;
    return this.events.publish(type, {
      conversationId: state.child.conversationId,
      projectId: state.child.projectId,
      parentAgentId: state.parentAgentId,
      childAgentId: state.child.id,
      runId: state.runId,
      ...payload,
    });
  }
}
