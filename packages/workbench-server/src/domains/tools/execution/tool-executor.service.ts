import { randomUUID } from "node:crypto";
import { isTerminalToolStatus } from "@nervekit/contracts/events";
import { type ToolCallRecord } from "@nervekit/contracts/tools";
import { requireToolDefinition } from "@nervekit/tools";
import type { ApplicationLogger } from "../../../infrastructure/diagnostics/index.js";
import type { PerformanceDiagnosticsPort } from "../../../core/ports.js";
import type { OrchestrationToolDispatcher } from "../orchestration/dispatcher.js";
import { toolErrorDetails } from "./tool-errors.js";
import { isToolExecutionSuspended } from "./tool-execution-suspension.js";
import { prepareToolResult } from "../artifacts/tool-result-preparation.js";
import type { ToolRequestOptions } from "./tool-service.js";
import { ToolResultPayloadStore } from "../artifacts/tool-result-payload-store.js";
import { toToolCallTranscriptRecord } from "../artifacts/tool-call-transcript-preview.js";
import {
  TOOL_CANCELLED_OUTCOME,
  toolTerminationPatch,
} from "./tool-termination.js";

export interface ToolExecutorDeps {
  getToolCall(id: string): ToolCallRecord;
  updateToolCall(
    id: string,
    patch: Partial<Omit<ToolCallRecord, "id" | "createdAt">>,
  ): Promise<ToolCallRecord>;
  publishToolCallUpdated(toolCall: ToolCallRecord): Promise<void>;
  claimExecution(
    id: string,
    expectedRevision: number,
    patch: Partial<Omit<ToolCallRecord, "id" | "createdAt">>,
  ): Promise<ToolCallRecord>;
  assertExecutionBoundary(toolCall: ToolCallRecord): Promise<void>;
  dispatcher: OrchestrationToolDispatcher;
  payloads?: ToolResultPayloadStore;
  /** Test/legacy construction fallback; runtime composition injects payloads. */
  storageHome?: string;
  logger?: ApplicationLogger;
  diagnostics?: PerformanceDiagnosticsPort;
}

export class ToolExecutorService {
  private readonly payloads: ToolResultPayloadStore;

  constructor(private readonly deps: ToolExecutorDeps) {
    this.payloads =
      deps.payloads ?? new ToolResultPayloadStore(deps.storageHome ?? "");
  }

  async executeAllowedTool(
    toolCallId: string,
    options: ToolRequestOptions = {},
  ): Promise<ToolCallRecord> {
    const drafted = this.deps.getToolCall(toolCallId);
    if (
      drafted.status !== "committed" ||
      drafted.phase !== "drafted" ||
      drafted.supervision?.status !== "approved"
    ) {
      throw new Error("Tool execution requires a durably approved draft.");
    }
    await this.deps.assertExecutionBoundary(drafted);
    const definition = requireToolDefinition(drafted.toolName as never);
    const startedAt = new Date().toISOString();
    const toolCall = await this.deps.claimExecution(
      toolCallId,
      drafted.revision,
      {
        status: "running",
        phase: "executing",
        execution: {
          kind: definition.executionKind,
          status: "running",
          executionId: `exec_${randomUUID()}`,
          startedAt,
        },
      },
    );
    await this.emitLifecycle(toolCall, options);
    const started = performance.now();
    await this.deps.logger?.info("Tool execution started", {
      toolCallId: toolCall.id,
      agentId: toolCall.agentId,
      conversationId: toolCall.conversationId,
      projectId: toolCall.projectId,
      runId: toolCall.runId,
      context: { toolName: toolCall.toolName, risk: toolCall.risk },
    });
    let terminal: ToolCallRecord | undefined;
    let executionError: unknown;
    let suspended = false;
    let ownsTerminalTransition = false;
    let prepared: Awaited<ReturnType<typeof prepareToolResult>> | undefined;
    try {
      const args = { ...(toolCall.args as Record<string, unknown>) };
      const result = await this.deps.dispatcher.execute(
        toolCall,
        args,
        options,
      );
      prepared = await prepareToolResult(result, {
        toolCallId: toolCall.id,
        conversationId: toolCall.conversationId,
        payloads: this.payloads,
        toolName: toolCall.toolName,
        args: toolCall.args,
        status: "completed",
        phase: "completed",
      });
      this.observeProjection(prepared.agentProjection);
    } catch (error) {
      executionError = error;
      if (isToolExecutionSuspended(error)) {
        suspended = true;
        terminal = this.deps.getToolCall(toolCall.id);
      } else {
        const patch = options.signal?.aborted
          ? toolTerminationPatch(toolCall, TOOL_CANCELLED_OUTCOME)
          : await (async () => {
              const details = toolErrorDetails(error);
              const base = {
                status: "failed" as const,
                phase: "failed" as const,
                error: details.message,
                errorDetails: details,
              };
              try {
                const failure = await prepareToolResult(
                  { error: details.message, errorDetails: details },
                  {
                    toolCallId: toolCall.id,
                    conversationId: toolCall.conversationId,
                    payloads: this.payloads,
                    toolName: toolCall.toolName,
                    args: toolCall.args,
                    status: "failed",
                    phase: "failed",
                    error: details.message,
                    errorDetails: details,
                  },
                );
                this.observeProjection(failure.agentProjection);
                return {
                  ...base,
                  ...(failure.resultPayload
                    ? { resultPayload: failure.resultPayload }
                    : {}),
                  validatedArtifacts: failure.validatedArtifacts,
                  agentProjection: failure.agentProjection,
                  agentPreview: failure.agentPreview,
                };
              } catch {
                return base;
              }
            })();
        const settlement = await this.settleToolCall(toolCall.id, patch);
        terminal = settlement.record;
        ownsTerminalTransition = settlement.owned;
      }
    }

    if (prepared) {
      const completionPatch = options.signal?.aborted
        ? toolTerminationPatch(toolCall, TOOL_CANCELLED_OUTCOME)
        : {
            status: "completed" as const,
            result: prepared.result,
            resultPreview: toToolCallTranscriptRecord({
              ...toolCall,
              result: prepared.result,
              resultPayload: prepared.resultPayload,
            }).resultPreview,
            resultPayload: prepared.resultPayload,
            validatedArtifacts: prepared.validatedArtifacts,
            agentProjection: prepared.agentProjection,
            agentPreview: prepared.agentPreview,
            error: undefined,
            errorDetails: undefined,
          };
      const settlement = await this.settleToolCall(
        toolCall.id,
        completionPatch,
      );
      terminal = settlement.record;
      ownsTerminalTransition = settlement.owned;
    }
    if (!terminal) throw new Error("Tool execution did not settle.");
    if (ownsTerminalTransition) await this.emitLifecycle(terminal, options);
    const durationMs = Math.round(performance.now() - started);
    if (suspended) {
      await this.deps.logger?.info("Tool execution suspended", {
        toolCallId: terminal.id,
        agentId: terminal.agentId,
        conversationId: terminal.conversationId,
        projectId: terminal.projectId,
        runId: terminal.runId,
        durationMs,
        context: { toolName: terminal.toolName },
      });
    } else if (terminal.status === "completed") {
      await this.deps.logger?.info("Tool execution completed", {
        toolCallId: terminal.id,
        agentId: terminal.agentId,
        conversationId: terminal.conversationId,
        projectId: terminal.projectId,
        runId: terminal.runId,
        durationMs,
        context: { toolName: terminal.toolName },
      });
    } else if (terminal.status === "cancelled") {
      await this.deps.logger?.info("Tool execution cancelled", {
        toolCallId: terminal.id,
        agentId: terminal.agentId,
        conversationId: terminal.conversationId,
        projectId: terminal.projectId,
        runId: terminal.runId,
        durationMs,
        context: { toolName: terminal.toolName },
      });
    } else {
      await this.deps.logger?.error("Tool execution failed", {
        toolCallId: terminal.id,
        agentId: terminal.agentId,
        conversationId: terminal.conversationId,
        projectId: terminal.projectId,
        runId: terminal.runId,
        durationMs,
        context: { toolName: terminal.toolName },
        error: executionError,
      });
    }
    return terminal;
  }
  private observeProjection(
    snapshot: NonNullable<ToolCallRecord["agentProjection"]>,
  ): void {
    const diagnostics = this.deps.diagnostics;
    if (!diagnostics?.enabled) return;
    const operation = `${snapshot.profile}.${snapshot.strategy}`;
    diagnostics.count("tool.projection", 1, operation);
    diagnostics.count(
      "tool.projectionInputBytes",
      snapshot.originalTextBytes,
      operation,
    );
    diagnostics.count(
      "tool.projectionDisplayedBytes",
      snapshot.displayedTextBytes,
      operation,
    );
    if (!snapshot.fastPath)
      diagnostics.count("tool.projectionTruncated", 1, operation);
    if (snapshot.recovery === "artifact")
      diagnostics.count("tool.projectionRecoveryArtifact", 1, operation);
    if (snapshot.recovery === "complete_payload")
      diagnostics.count("tool.projectionRecoveryPayload", 1, operation);
    if (snapshot.profile === "conservative_fallback")
      diagnostics.count("tool.projectionFallback", 1, operation);
  }

  private async settleToolCall(
    toolCallId: string,
    patch: Partial<Omit<ToolCallRecord, "id" | "createdAt">>,
  ): Promise<{ record: ToolCallRecord; owned: boolean }> {
    try {
      return {
        record: await this.deps.updateToolCall(toolCallId, patch),
        owned: true,
      };
    } catch (error) {
      const current = this.deps.getToolCall(toolCallId);
      if (isTerminalToolStatus(current.status)) {
        return { record: current, owned: false };
      }
      throw error;
    }
  }

  /**
   * Route one lifecycle update to the run execution sink when the run owns the
   * tool (the RunCoordinator commits and publishes the durable event), else
   * publish it directly for non-run tool calls.
   */
  private async emitLifecycle(
    toolCall: ToolCallRecord,
    options: ToolRequestOptions,
  ): Promise<void> {
    if (options.onLifecycle) {
      await options.onLifecycle(toolCall);
      return;
    }
    await this.deps.publishToolCallUpdated(toolCall);
  }
}
