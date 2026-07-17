import type { RunRecord } from "@nervekit/contracts";
import type { RunExecutionSink } from "@nervekit/host-runtime";
import type { AgentHarnessEvent } from "@nervekit/host-runtime/harness";
import type { SandboxConversationLiveProjector } from "./conversation-live-projector.js";
import { messageText } from "./run-execution-errors.js";
import type { SandboxPromptControl } from "./run-prompt-control.js";
import {
  type SandboxToolCallTracker,
  toolTranscriptId,
} from "./run-tool-call-tracker.js";

/**
 * Translates harness events into live-projector calls and durable sink
 * mutations: turn/message starts and updates, queue delivery acknowledgement,
 * tool start/update/end, and materialized assistant entries. Reuses the
 * shared `SandboxConversationLiveProjector`.
 */
export class SandboxHarnessEventProjector {
  constructor(
    private readonly deps: {
      run: RunRecord;
      sink: RunExecutionSink;
      liveProjector: SandboxConversationLiveProjector;
      toolCalls: SandboxToolCallTracker;
      prompts: SandboxPromptControl;
    },
  ) {}

  async project(event: AgentHarnessEvent): Promise<void> {
    const { run, sink, liveProjector, toolCalls, prompts } = this.deps;
    if (event.type === "queue_drained") {
      for (const promptId of event.messageIds) {
        await sink.promptDelivered(promptId);
      }
      return;
    }
    if (event.type === "turn_start") {
      liveProjector.startTurn();
      await prompts.deliverPending();
      return;
    }
    if (event.type === "message_start" && event.message.role === "assistant") {
      liveProjector.startAssistantMessage();
      return;
    }
    if (event.type === "message_update") {
      liveProjector.updateAssistantMessage(event);
      return;
    }
    if (event.type === "tool_execution_start") {
      const record = toolCalls.record(
        event.toolCallId,
        event.toolName,
        "running",
        event.args,
      );
      if (record) await sink.upsertToolCalls([record]);
      return;
    }
    if (event.type === "tool_execution_update") {
      liveProjector.publishToolOutput(
        event.toolCallId,
        toolTranscriptId(event.toolCallId),
        event.toolName,
        event.partialResult,
      );
      return;
    }
    if (event.type === "tool_execution_end") {
      const record = toolCalls.record(
        event.toolCallId,
        event.toolName,
        event.isError ? "error" : "completed",
        undefined,
        event.result,
      );
      if (record) await sink.upsertToolCalls([record]);
      return;
    }
    if (event.type === "message_end" && event.message.role === "assistant") {
      const text = messageText(event.message);
      const materialized = liveProjector.materializeAssistantMessage();
      if (!text) return;
      await sink.appendEntries([
        {
          id: `entry_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          conversationId: run.conversationId,
          agentId: run.agentId,
          runId: run.runId,
          turnId: materialized?.turnId,
          liveMessageId: materialized?.liveMessageId,
          messageOrdinal: materialized?.messageOrdinal,
          role: "assistant",
          kind: "message",
          text: text.slice(0, 200_000),
          createdAt: new Date().toISOString(),
        },
      ]);
    }
  }
}
