import { randomUUID } from "node:crypto";
import type { ToolCallRecord } from "@nervekit/contracts";
import { requireToolDefinition } from "@nervekit/tools";
import type { ApplicationLogger } from "../../infrastructure/diagnostics/index.js";
import type { OrchestrationToolDispatcher } from "./orchestration-tool-dispatcher.js";
import { toolErrorDetails } from "./tool-errors.js";
import { isToolExecutionSuspended } from "./tool-execution-suspension.js";
import { prepareToolResult } from "./tool-result-bounds.js";
import type { ToolRequestOptions } from "./tool-service.js";
import { ToolResultPayloadStore } from "./tool-result-payload-store.js";
import { toToolCallTranscriptRecord } from "./tool-call-transcript-preview.js";

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
    let terminal: ToolCallRecord;
    let executionError: unknown;
    let suspended = false;
    try {
      const args = { ...(toolCall.args as Record<string, unknown>) };
      const result = await this.deps.dispatcher.execute(
        toolCall,
        args,
        options,
      );
      const prepared = await prepareToolResult(result, {
        toolCallId: toolCall.id,
        conversationId: toolCall.conversationId,
        payloads: this.payloads,
      });
      const resultPreview = toToolCallTranscriptRecord({
        ...toolCall,
        result: prepared.result,
        resultPayload: prepared.resultPayload,
      }).resultPreview;
      terminal = await this.deps.updateToolCall(toolCall.id, {
        status: "completed",
        result: prepared.result,
        resultPreview,
        resultPayload: prepared.resultPayload,
        error: undefined,
        errorDetails: undefined,
      });
    } catch (error) {
      executionError = error;
      if (isToolExecutionSuspended(error)) {
        suspended = true;
        terminal = this.deps.getToolCall(toolCall.id);
      } else {
        const details = toolErrorDetails(error);
        terminal = await this.deps.updateToolCall(toolCall.id, {
          status: "failed",
          error: details.message,
          errorDetails: details,
        });
      }
    }

    await this.emitLifecycle(terminal, options);
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
