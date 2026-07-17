import type { AgentToolSuspensionData } from "@nervekit/host-runtime/harness";
import type {
  CheckpointCommand,
  RunExecutionSink,
  WaitCommand,
} from "@nervekit/host-runtime";
import {
  toolNameSchema,
  type AgentRecord,
  type ToolCallRecord,
} from "@nervekit/contracts";
import { toToolCallTranscriptRecord } from "../../tools/tool-call-transcript-preview.js";
import type { WorkbenchAgentMechanics } from "./workbench-agent-mechanics.js";
import { recordFromUnknown } from "./harness-execution-shared.js";

interface SequentialToolApprovalBatchInput {
  agent: AgentRecord;
  runId: string;
  suspension: AgentToolSuspensionData;
  deps: WorkbenchAgentMechanics["deps"];
  sink: RunExecutionSink;
  checkpointCommand(
    boundary: CheckpointCommand["boundary"],
    interactionId?: string,
  ): Promise<CheckpointCommand>;
}

export async function waitForSequentialToolApprovalBatch(
  input: SequentialToolApprovalBatchInput,
): Promise<void> {
  const { agent, runId, suspension, deps, sink } = input;
  const primaryToolCall = deps.tools.getToolCall(suspension.toolCallId);
  const toolCalls = [primaryToolCall];
  if (primaryToolCall.status === "pending_approval") {
    for (const remaining of suspension.remainingToolCalls ?? []) {
      const parsedToolName = toolNameSchema.safeParse(remaining.name);
      if (!parsedToolName.success) {
        throw new Error(`Unknown sequential tool: ${remaining.name}`);
      }
      const args = recordFromUnknown(remaining.arguments);
      let staged: ToolCallRecord;
      try {
        const response = await deps.tools.requestTool(
          agent,
          parsedToolName.data,
          args,
          {
            sourceToolCallId: remaining.id,
            providerToolCallId: remaining.id,
            runId,
            anchor: deps.state.conversationRuntime.resolveToolAnchor(
              runId,
              remaining.id,
            ),
            forceApproval: true,
            durableSuspend: true,
            onLifecycle: (toolCall) =>
              sink.upsertToolCalls([toToolCallTranscriptRecord(toolCall)]),
          },
        );
        staged = response.toolCall;
      } catch (stagingError) {
        staged = await deps.tools.recordProviderToolCallError(
          agent,
          parsedToolName.data,
          args,
          stagingError instanceof Error
            ? stagingError.message
            : String(stagingError),
          {
            sourceToolCallId: remaining.id,
            providerToolCallId: remaining.id,
            runId,
            anchor: deps.state.conversationRuntime.resolveToolAnchor(
              runId,
              remaining.id,
            ),
          },
        );
        await sink.upsertToolCalls([toToolCallTranscriptRecord(staged)]);
      }
      if (!isStagedToolCall(staged)) {
        throw new Error(
          `Sequential tool ${remaining.name} was not durably staged.`,
        );
      }
      toolCalls.push(staged);
    }
  }

  const primaryInteractionId = interactionIdForToolCall(primaryToolCall, deps);
  const batchToolCallIds =
    toolCalls.length > 1 ? toolCalls.map((toolCall) => toolCall.id) : undefined;
  const checkpoint = await input.checkpointCommand(
    "suspension",
    primaryInteractionId,
  );
  const waits = toolCalls
    .filter((toolCall) => toolCall.status === "pending_approval")
    .map((toolCall) =>
      canonicalWaitCommand(
        interactionIdForToolCall(toolCall, deps),
        toolCall,
        checkpoint,
        toolCall.id === primaryToolCall.id
          ? suspension.reason
          : `Tool ${toolCall.toolName} is awaiting user approval.`,
        deps,
        batchToolCallIds,
      ),
    );
  if (waits.length === 0) {
    await sink.wait(
      canonicalWaitCommand(
        primaryInteractionId,
        primaryToolCall,
        checkpoint,
        suspension.reason,
        deps,
        batchToolCallIds,
      ),
    );
  } else if (waits.length === 1) {
    await sink.wait(waits[0]!);
  } else {
    await sink.waitMany(waits);
  }
}

function isStagedToolCall(toolCall: ToolCallRecord): boolean {
  return ["pending_approval", "completed", "denied", "error"].includes(
    toolCall.status,
  );
}

function interactionIdForToolCall(
  toolCall: ToolCallRecord,
  deps: WorkbenchAgentMechanics["deps"],
): string {
  return (
    deps.tools
      .listUserQuestions()
      .find((question) => question.toolCallId === toolCall.id)?.id ??
    deps.plans
      .listPlanReviews()
      .find((review) => review.toolCallId === toolCall.id)?.id ??
    toolCall.id
  );
}

function canonicalWaitCommand(
  interactionId: string,
  toolCall: ToolCallRecord,
  checkpoint: CheckpointCommand,
  reason: string,
  deps: WorkbenchAgentMechanics["deps"],
  batchToolCallIds?: readonly string[],
): WaitCommand {
  if (toolCall.toolName === "plan_mode_present") {
    const review = deps.plans
      .listPlanReviews()
      .find((candidate) => candidate.toolCallId === toolCall.id);
    if (!review) {
      throw new Error(
        `Plan review for tool call ${toolCall.id} was not found.`,
      );
    }
    return {
      kind: "plan_review",
      interactionId,
      toolCallId: toolCall.id,
      batchToolCallIds,
      prompt: reason,
      planReview: review,
      checkpoint,
    };
  }
  const approval = deps.tools
    .listApprovals()
    .find(
      (candidate) =>
        candidate.toolCallId === toolCall.id && candidate.status === "pending",
    );
  if (approval) {
    return {
      kind: "approval",
      interactionId,
      toolCallId: toolCall.id,
      batchToolCallIds,
      prompt: reason,
      risk: [approval.risk, approval.reason],
      normalizedArgs:
        toolCall.args && typeof toolCall.args === "object"
          ? (toolCall.args as Record<string, unknown>)
          : {},
      offeredScopes: ["single_call"],
      checkpoint,
    };
  }
  const question = deps.tools
    .listUserQuestions()
    .find((candidate) => candidate.toolCallId === toolCall.id);
  return {
    kind: "question",
    interactionId,
    toolCallId: toolCall.id,
    batchToolCallIds,
    prompt: question?.question ?? reason,
    context: question?.context,
    placeholder: question?.placeholder,
    required: true,
    checkpoint,
  };
}
