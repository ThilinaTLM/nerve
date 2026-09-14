import { randomUUID } from "node:crypto";
import type { AgentRecord } from "@nervekit/contracts/agents";
import type { ToolCallRecord, ToolName } from "@nervekit/contracts/tools";
import { requireToolDefinition } from "@nervekit/tools/catalog";
import type { OrchestrationToolDispatcher } from "../orchestration/dispatcher.js";
import { prepareToolResult } from "../artifacts/tool-result-preparation.js";
import type { ToolResultPayloadStore } from "../artifacts/tool-result-payload-store.js";
import { toToolCallTranscriptRecord } from "../artifacts/tool-call-transcript-preview.js";
import { toolErrorDetails } from "./tool-errors.js";
import type { ToolRequestOptions } from "./tool-runtime-ports.js";

/** Invokes an already-authorized tool without touching legacy repositories. */
export class CanonicalToolExternalInvoker {
  constructor(
    private readonly dispatcher: OrchestrationToolDispatcher,
    private readonly payloads: ToolResultPayloadStore,
  ) {}

  async invoke(input: {
    agent: AgentRecord;
    effectId: string;
    attemptId: string;
    providerToolCallId: string;
    toolName: ToolName;
    normalizedArgs: Record<string, unknown>;
    cwd: string;
    risk: ToolCallRecord["risk"];
    runId: string;
    options?: ToolRequestOptions;
  }): Promise<ToolCallRecord> {
    const now = new Date().toISOString();
    const definition = requireToolDefinition(input.toolName);
    if (definition.traits.includes("suspending")) {
      throw new Error(
        "Suspending tools require canonical interaction authority before invocation.",
      );
    }
    const running: ToolCallRecord = {
      id: `tool_${input.effectId.slice("effect_".length)}`,
      agentId: input.agent.id,
      conversationId: input.agent.conversationId,
      projectId: input.agent.projectId,
      toolName: input.toolName,
      sourceToolCallId: input.providerToolCallId,
      providerToolCallId: input.providerToolCallId,
      runId: input.runId,
      risk: input.risk,
      args: input.normalizedArgs,
      cwd: input.cwd,
      status: "running",
      phase: "executing",
      execution: {
        kind: definition.executionKind,
        status: "running",
        executionId: `exec_${input.attemptId.slice("attempt_".length)}_${randomUUID()}`,
        startedAt: now,
      },
      revision: 1,
      attempt: 1,
      interactions: [],
      createdAt: now,
      updatedAt: now,
    };
    try {
      const result = await this.dispatcher.execute(
        running,
        input.normalizedArgs,
        input.options,
      );
      const prepared = await prepareToolResult(result, {
        toolCallId: running.id,
        conversationId: running.conversationId,
        payloads: this.payloads,
        toolName: running.toolName,
        args: running.args,
        status: "completed",
        phase: "completed",
      });
      const terminal: ToolCallRecord = {
        ...running,
        status: "completed",
        phase: "completed",
        result: prepared.result,
        resultPayload: prepared.resultPayload,
        validatedArtifacts: prepared.validatedArtifacts,
        agentProjection: prepared.agentProjection,
        agentPreview: prepared.agentPreview,
        execution: {
          ...running.execution!,
          status: "completed",
          endedAt: new Date().toISOString(),
        },
        revision: 2,
        updatedAt: new Date().toISOString(),
      };
      return {
        ...terminal,
        resultPreview: toToolCallTranscriptRecord(terminal).resultPreview,
      };
    } catch (error) {
      const details = toolErrorDetails(error);
      const prepared = await prepareToolResult(
        { error: details.message, errorDetails: details },
        {
          toolCallId: running.id,
          conversationId: running.conversationId,
          payloads: this.payloads,
          toolName: running.toolName,
          args: running.args,
          status: "failed",
          phase: "failed",
          error: details.message,
          errorDetails: details,
        },
      ).catch(() => undefined);
      return {
        ...running,
        status: "failed",
        phase: "failed",
        error: details.message,
        errorDetails: details,
        ...(prepared
          ? {
              result: prepared.result,
              resultPayload: prepared.resultPayload,
              validatedArtifacts: prepared.validatedArtifacts,
              agentProjection: prepared.agentProjection,
              agentPreview: prepared.agentPreview,
            }
          : {}),
        execution: {
          ...running.execution!,
          status: "failed",
          endedAt: new Date().toISOString(),
        },
        revision: 2,
        updatedAt: new Date().toISOString(),
      };
    }
  }
}
