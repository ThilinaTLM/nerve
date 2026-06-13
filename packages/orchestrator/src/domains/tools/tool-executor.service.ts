import type { ToolCallRecord } from "@nerve/shared";
import type { ApplicationLogger } from "../../logging.js";
import type { ToolRequestOptions } from "../../tool-service.js";
import type { OrchestrationToolDispatcher } from "./orchestration-tool-dispatcher.js";
import { isToolExecutionSuspended } from "./tool-execution-suspension.js";

export interface ToolExecutorDeps {
  getToolCall(id: string): ToolCallRecord;
  updateToolCall(
    id: string,
    patch: Partial<Omit<ToolCallRecord, "id" | "createdAt">>,
  ): Promise<ToolCallRecord>;
  publishToolCallUpdated(toolCall: ToolCallRecord): Promise<void>;
  dispatcher: OrchestrationToolDispatcher;
  logger?: ApplicationLogger;
}

export class ToolExecutorService {
  constructor(private readonly deps: ToolExecutorDeps) {}

  async executeAllowedTool(
    toolCallId: string,
    options: ToolRequestOptions = {},
  ): Promise<ToolCallRecord> {
    const toolCall = await this.deps.updateToolCall(toolCallId, {
      status: "running",
    });
    await this.deps.publishToolCallUpdated(toolCall);
    const started = performance.now();
    await this.deps.logger?.info("Tool execution started", {
      toolCallId: toolCall.id,
      agentId: toolCall.agentId,
      conversationId: toolCall.conversationId,
      projectId: toolCall.projectId,
      runId: toolCall.runId,
      context: { toolName: toolCall.toolName, risk: toolCall.risk },
    });
    try {
      const args = { ...(toolCall.args as Record<string, unknown>) };
      const result = await this.deps.dispatcher.execute(
        toolCall,
        args,
        options,
      );
      const completed = await this.deps.updateToolCall(toolCall.id, {
        status: "completed",
        result,
        error: undefined,
      });
      await this.deps.publishToolCallUpdated(completed);
      await this.deps.logger?.info("Tool execution completed", {
        toolCallId: completed.id,
        agentId: completed.agentId,
        conversationId: completed.conversationId,
        projectId: completed.projectId,
        runId: completed.runId,
        durationMs: Math.round(performance.now() - started),
        context: { toolName: completed.toolName },
      });
      return completed;
    } catch (error) {
      if (isToolExecutionSuspended(error)) {
        await this.deps.logger?.info("Tool execution suspended", {
          toolCallId: toolCall.id,
          agentId: toolCall.agentId,
          conversationId: toolCall.conversationId,
          projectId: toolCall.projectId,
          runId: toolCall.runId,
          durationMs: Math.round(performance.now() - started),
          context: { toolName: toolCall.toolName },
        });
        return this.deps.getToolCall(toolCall.id);
      }
      const failed = await this.deps.updateToolCall(toolCall.id, {
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
      await this.deps.publishToolCallUpdated(failed);
      await this.deps.logger?.error("Tool execution failed", {
        toolCallId: failed.id,
        agentId: failed.agentId,
        conversationId: failed.conversationId,
        projectId: failed.projectId,
        runId: failed.runId,
        durationMs: Math.round(performance.now() - started),
        context: { toolName: failed.toolName },
        error,
      });
      return failed;
    }
  }
}
