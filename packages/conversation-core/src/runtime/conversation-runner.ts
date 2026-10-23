import type { AgentConfigurationPort } from "../configuration.js";
import { loadProjectionOptions } from "../context/asset-projection.js";
import type { AssetStore } from "../assets/asset-store.js";
import { setTimeout as delay } from "node:timers/promises";
import { createId } from "@nervekit/contracts";
import {
  assistantMessagePayloadSchema,
  type ConversationEvent,
  type CompactionOperation,
} from "@nervekit/contracts/core";
import type { ModelSelection } from "@nervekit/contracts/models";
import { isRetryableProviderError } from "@nervekit/harness/models";
import {
  estimatePathUsage,
  isContextOverflowAssistantMessage,
  runCompaction,
  shouldCompact,
} from "../context/index.js";
import type { InputBoundary } from "../inputs/input-queue.service.js";
import type { InputQueueService } from "../inputs/input-queue.service.js";
import type { ModelPort } from "../ports.js";
import type { CoreStorage } from "../storage/core-storage.js";
import type { ToolCallService } from "../tool-calls/tool-call.service.js";
import type { CompactionOperations } from "./compaction-operations.js";
import type { CoreEmitter } from "./core-change.js";
import { StaleRequestCaptureError, type ModelTurn } from "./model-turn.js";
import type { StatusService } from "./status.js";
import { abortable } from "./abortable.js";
import { shutdownReason } from "./shutdown.js";
import { hasRejectedPlan } from "./plan-rejection.js";

export interface ExecutionFinished {
  conversationId: string;
  executionId: string;
  transition: "completed" | "failed" | "cancelled" | "interrupted";
  event: ConversationEvent;
}
export class ConversationRunner {
  constructor(
    private readonly options: {
      configuration: AgentConfigurationPort;
      storage: CoreStorage;
      assets?: AssetStore;
      inputs: InputQueueService;
      toolCalls: ToolCallService;
      models: ModelPort;
      modelTurn: ModelTurn;
      status: StatusService;
      emit: CoreEmitter;
      compactions: CompactionOperations;
      now(): string;
    },
  ) {}
  path(id: string): ConversationEvent[] {
    return this.options.storage.events
      .pathFromHead(id, { limit: Number.MAX_SAFE_INTEGER })
      .reverse();
  }
  async compact(
    id: string,
    signal: AbortSignal,
    lifecycle: {
      reason: CompactionOperation["reason"];
      executionId?: string;
      operation?: CompactionOperation;
    } = { reason: "manual" },
  ): Promise<ModelSelection> {
    const operation =
      lifecycle.operation ??
      this.options.compactions.start(
        id,
        lifecycle.reason,
        this.options.storage.conversations.get(id)?.headEventId ?? null,
        lifecycle.executionId,
      );
    const stopping = () => this.options.compactions.stopping(id, operation.id);
    signal.addEventListener("abort", stopping, { once: true });
    let committed = false;
    try {
      signal.throwIfAborted();
      let capture;
      let resolved;
      let path: ConversationEvent[] = [];
      let projectionOptions: Partial<
        Awaited<ReturnType<typeof loadProjectionOptions>>
      > = {};
      do {
        const source = await abortable(
          this.options.configuration.captureCompaction(id),
          signal,
        );
        capture = {
          ...structuredClone({
            model: source.model,
            reasoningLevel: source.reasoningLevel,
            settings: source.settings,
          }),
          isCurrent: source.isCurrent,
        };
        resolved = structuredClone(
          await abortable(
            this.options.models.resolve(structuredClone(capture.model)),
            signal,
          ),
        );
        path = this.path(id);
        projectionOptions = this.options.assets
          ? await loadProjectionOptions(path, this.options.assets)
          : {};
      } while (!capture.isCurrent());
      const config = {
        model: structuredClone(capture.model),
        reasoningLevel: capture.reasoningLevel,
      };
      const autoSettings = structuredClone(capture.settings);
      const payload = await abortable(
        runCompaction({
          path,
          ...projectionOptions,
          ...resolved,
          reasoningLevel: config.reasoningLevel,
          autoSettings,
          signal,
          onProgress: (progress) => {
            if (!signal.aborted)
              this.options.compactions.progress(id, operation.id, progress);
          },
        }),
        signal,
      );
      signal.throwIfAborted();
      const event = this.options.storage.transaction(() => {
        const appended = this.options.storage.events.append({
          id: operation.id,
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
      committed = true;
      this.options.emit({ kind: "event_appended", conversationId: id, event });
      this.options.compactions.settle(id, operation.id, {
        status: "completed",
        summary: payload.summary,
      });
      return config.model;
    } catch (error) {
      if (!committed)
        this.options.compactions.settle(
          id,
          operation.id,
          signal.aborted
            ? { status: "cancelled" }
            : {
                status: "failed",
                errorMessage:
                  error instanceof Error ? error.message : String(error),
              },
        );
      throw error;
    } finally {
      signal.removeEventListener("abort", stopping);
    }
  }
  async compactPending(
    id: string,
    signal: AbortSignal,
    executionId?: string,
  ): Promise<ModelSelection | undefined> {
    const pending = this.options.compactions.pending(id);
    if (!pending) return;
    const operation = this.options.compactions.begin(id, pending.operation.id, {
      executionId,
      headEventId:
        this.options.storage.conversations.get(id)?.headEventId ?? null,
    });
    if (!operation) return;
    return this.compact(id, signal, {
      reason: "manual",
      executionId,
      operation,
    });
  }

  async compactStandalone(id: string, signal: AbortSignal): Promise<void> {
    try {
      await this.compactPending(id, signal);
    } catch (error) {
      if (signal.aborted) throw error;
    }
  }

  private async deliverAtBoundary(
    id: string,
    signal: AbortSignal,
    boundary: InputBoundary,
    executionId: string,
  ): Promise<ModelSelection | undefined> {
    const { inputs, status, storage } = this.options;
    const pending = this.options.compactions.pending(id);
    let model: ModelSelection | undefined;
    if (pending) {
      storage.transaction(() => {
        inputs.deliver(id, boundary, {
          beforeSequence: pending.afterInputSequence,
        });
        status.refresh(id);
      });
      try {
        model = await this.compactPending(id, signal, executionId);
      } catch (error) {
        if (signal.aborted) throw error;
      }
    }
    storage.transaction(() => {
      inputs.deliver(id, boundary);
      status.refresh(id);
    });
    return model;
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
      let boundaryModel = !existingExecutionId
        ? await this.deliverAtBoundary(
            id,
            signal,
            { kind: "execution_start", executionId },
            executionId,
          )
        : undefined;
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
        const compactedAtTurn = await this.deliverAtBoundary(
          id,
          signal,
          { kind: "turn", executionId },
          executionId,
        );
        const turnId = createId("turn");
        let overflowRetried = false;
        // Avoid repeated compaction without a provider attempt, but reconsider
        // capacity if preparation selects a different model after compaction.
        let compactedModel: ModelSelection | undefined =
          compactedAtTurn ?? boundaryModel;
        boundaryModel = undefined;
        let attempt = 1;
        const retry = structuredClone(
          await abortable(this.options.configuration.captureRetry(id), signal),
        );
        const maxAttempts = retry.enabled ? retry.maxRetries + 1 : 1;
        let message: Awaited<ReturnType<ModelTurn["runPrepared"]>>;
        let requestCaptureId: string | undefined;
        try {
          while (true) {
            if (requestCaptureId)
              this.options.configuration.releaseRequest?.(requestCaptureId);
            requestCaptureId = undefined;
            signal.throwIfAborted();
            try {
              // Configuration belongs to an attempt, not to the logical turn.
              // Input delivery stays outside this loop so retries never replay it.
              const conversation = storage.conversations.get(id);
              const context = storage.conversations.getContext(id);
              if (!this.options.configuration.resolveConfig)
                throw new Error("Agent configuration resolver is unavailable");
              const config =
                context &&
                (await this.options.configuration.resolveConfig(id, context));
              if (!conversation || !config)
                throw new Error("Conversation not found");
              const project = storage.projects.get(conversation.projectId);
              if (!project) throw new Error("Project not found");
              const input = {
                conversation,
                config,
                projectDir: project.directory,
                path: this.path(id),
                turnId,
                signal,
              };
              const prepared = await abortable(
                this.options.modelTurn.prepareRequest(input),
                signal,
              );
              requestCaptureId = prepared.requestCaptureId;
              const autoSettings = await abortable(
                this.options.configuration
                  .captureCompaction(id)
                  .then((capture) => capture.settings),
                signal,
              );
              if (
                !(
                  compactedModel?.provider === prepared.model.provider &&
                  compactedModel.modelId === prepared.model.modelId
                ) &&
                shouldCompact(
                  estimatePathUsage(input.path),
                  prepared.resolved.model,
                  autoSettings,
                )
              ) {
                compactedModel = await this.compact(id, signal, {
                  reason: "threshold",
                  executionId,
                });
                continue;
              }
              compactedModel = undefined;
              message = await abortable(
                this.options.modelTurn.runPrepared(input, prepared),
                signal,
              );
              if (
                isContextOverflowAssistantMessage(message) &&
                !overflowRetried
              ) {
                overflowRetried = true;
                compactedModel = await this.compact(id, signal, {
                  reason: "overflow",
                  executionId,
                });
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
              if (requestCaptureId)
                this.options.configuration.releaseRequest?.(requestCaptureId);
              requestCaptureId = undefined;
              signal.throwIfAborted();
              if (error instanceof StaleRequestCaptureError) continue;
              const text =
                error instanceof Error ? error.message : String(error);
              if (!isRetryableProviderError(text) || attempt >= maxAttempts)
                throw error;
              const delayMs = retry.baseDelayMs * 2 ** (attempt - 1);
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
            const calls = toolCalls.createFromAssistantMessage(
              id,
              turnId,
              event,
              requestCaptureId,
            );
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
          await abortable(
            toolCalls.start(calls.map((call) => call.id)),
            signal,
          );
          signal.throwIfAborted();
          await abortable(toolCalls.waitForTurn(id, turnId), signal);
          signal.throwIfAborted();
          // Rejection ends this execution, rather than resuming it to revise the plan.
          // The persisted pause gate blocks other wakes until a new user prompt.
          if (
            hasRejectedPlan(
              storage.events
                .since(id, event.sequence)
                .filter((response) => response.turnId === turnId),
            )
          )
            break;
          if (
            !calls.length &&
            !inputs.hasDeliverable(id, { kind: "turn", executionId })
          )
            break;
        } finally {
          if (requestCaptureId)
            this.options.configuration.releaseRequest?.(requestCaptureId);
        }
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
