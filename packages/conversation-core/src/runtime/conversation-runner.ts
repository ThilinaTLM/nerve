import { loadProjectionOptions } from "../context/asset-projection.js";
import type { AssetStore } from "../assets/asset-store.js";
import { setTimeout as delay } from "node:timers/promises";
import { createId } from "@nervekit/contracts";
import {
  assistantMessagePayloadSchema,
  type ConversationEvent,
} from "@nervekit/contracts/core";
import { isRetryableProviderError } from "@nervekit/harness/models";
import {
  estimatePathUsage,
  isContextOverflowAssistantMessage,
  runCompaction,
  shouldCompact,
} from "../context/index.js";
import type { InputQueueService } from "../inputs/input-queue.service.js";
import type { ModelPort } from "../ports.js";
import type { CoreStorage } from "../storage/core-storage.js";
import type { ToolCallService } from "../tool-calls/tool-call.service.js";
import type { CoreEmitter } from "./core-change.js";
import type { ModelTurn } from "./model-turn.js";
import type { StatusService } from "./status.js";
import { abortable } from "./abortable.js";
import { shutdownReason } from "./shutdown.js";

export interface ExecutionFinished {
  conversationId: string;
  executionId: string;
  transition: "completed" | "failed" | "cancelled" | "interrupted";
  event: ConversationEvent;
}
export class ConversationRunner {
  constructor(
    private readonly options: {
      storage: CoreStorage;
      assets?: AssetStore;
      inputs: InputQueueService;
      toolCalls: ToolCallService;
      models: ModelPort;
      modelTurn: ModelTurn;
      status: StatusService;
      emit: CoreEmitter;
      now(): string;
    },
  ) {}
  path(id: string): ConversationEvent[] {
    return this.options.storage.events
      .pathFromHead(id, { limit: Number.MAX_SAFE_INTEGER })
      .reverse();
  }
  async compact(id: string, signal: AbortSignal): Promise<void> {
    const config = this.options.storage.conversations.getConfig(id);
    if (!config) throw new Error("Conversation not found");
    const resolved = await abortable(
      this.options.models.resolve(config.model),
      signal,
    );
    const path = this.path(id);
    const projectionOptions = this.options.assets
      ? await loadProjectionOptions(path, this.options.assets)
      : {};
    const payload = await abortable(
      runCompaction({
        path,
        ...projectionOptions,
        ...resolved,
        reasoningLevel: config.reasoningLevel,
        signal,
      }),
      signal,
    );
    signal.throwIfAborted();
    const event = this.options.storage.transaction(() => {
      const appended = this.options.storage.events.append({
        id: createId("evt"),
        conversationId: id,
        type: "compaction",
        llmRepresentation: "user",
        turnId: null,
        inputId: null,
        payload,
        createdAt: this.options.now(),
      });
      this.options.status.refresh(id);
      return appended;
    });
    this.options.emit({ kind: "event_appended", conversationId: id, event });
  }
  async run(
    id: string,
    signal: AbortSignal,
    existingExecutionId?: string,
  ): Promise<void> {
    if (signal.aborted) return;
    const { storage, inputs, status, toolCalls } = this.options;
    const started = existingExecutionId
      ? null
      : status.transition(id, {
          subtype: "execution_state",
          transition: "started",
        });
    const executionId = existingExecutionId ?? started!.id;
    let transition: ExecutionFinished["transition"] = "completed";
    let failure: { message: string } | undefined;
    try {
      if (!existingExecutionId)
        storage.transaction(() => {
          inputs.deliver(id, { kind: "execution_start", executionId });
          status.refresh(id);
        });
      while (true) {
        signal.throwIfAborted();
        // Pause blocks subsequent automatic turns, without discarding the current response.
        if (storage.conversations.get(id)?.paused) {
          status.transition(id, {
            subtype: "execution_state",
            transition: "waiting",
            executionId,
          });
          return;
        }
        storage.transaction(() => {
          inputs.deliver(id, { kind: "turn", executionId });
          status.refresh(id);
        });
        const turnId = createId("turn");
        const conversation = storage.conversations.get(id);
        const config = storage.conversations.getConfig(id);
        if (!conversation || !config) throw new Error("Conversation not found");
        const project = storage.projects.get(conversation.projectId);
        if (!project) throw new Error("Project not found");
        const resolved = await abortable(
          this.options.models.resolve(config.model),
          signal,
        );
        if (shouldCompact(estimatePathUsage(this.path(id)), resolved.model))
          await this.compact(id, signal);
        let overflowRetried = false;
        let attempt = 1;
        const maxAttempts = 3;
        let message;
        while (true) {
          signal.throwIfAborted();
          try {
            message = await abortable(
              this.options.modelTurn.run({
                conversation,
                config,
                projectDir: project.directory,
                path: this.path(id),
                turnId,
                signal,
              }),
              signal,
            );
            if (
              isContextOverflowAssistantMessage(message) &&
              !overflowRetried
            ) {
              overflowRetried = true;
              await this.compact(id, signal);
              continue;
            }
            if (
              message.stopReason === "error" ||
              message.stopReason === "aborted"
            )
              throw new Error(
                message.errorMessage ??
                  `Provider response ${message.stopReason}`,
              );
            break;
          } catch (error) {
            signal.throwIfAborted();
            const text = error instanceof Error ? error.message : String(error);
            if (!isRetryableProviderError(text) || attempt >= maxAttempts)
              throw error;
            const delayMs = 1000 * 2 ** (attempt - 1);
            status.transition(id, {
              subtype: "execution_state",
              transition: "retrying",
              executionId,
              retry: { attempt, maxAttempts, delayMs, error: text },
            });
            attempt++;
            await delay(delayMs, undefined, { signal });
          }
        }
        signal.throwIfAborted();
        const { event, calls } = storage.transaction(() => {
          const event = storage.events.append({
            id: createId("evt"),
            conversationId: id,
            type: "assistant_message",
            llmRepresentation: "assistant",
            turnId,
            inputId: null,
            payload: assistantMessagePayloadSchema.parse(message),
            createdAt: this.options.now(),
          });
          const calls = toolCalls.createFromAssistantMessage(id, turnId, event);
          status.refresh(id);
          return { event, calls };
        });
        this.options.emit({
          kind: "event_appended",
          conversationId: id,
          event,
        });
        for (const call of calls)
          this.options.emit({
            kind: "tool_call_changed",
            conversationId: id,
            toolCall: call,
          });
        signal.throwIfAborted();
        await abortable(toolCalls.start(calls.map((call) => call.id)), signal);
        signal.throwIfAborted();
        await abortable(toolCalls.waitForTurn(id, turnId), signal);
        signal.throwIfAborted();
        if (
          !calls.length &&
          !inputs.hasDeliverable(id, { kind: "turn", executionId })
        )
          break;
      }
    } catch (error) {
      if (signal.aborted && signal.reason === shutdownReason) return;
      transition = signal.aborted ? "cancelled" : "failed";
      if (!signal.aborted)
        failure = {
          message: error instanceof Error ? error.message : String(error),
        };
    }
    status.transition(id, {
      subtype: "execution_state",
      transition,
      executionId,
      ...(failure ? { failure } : {}),
    });
  }
}
