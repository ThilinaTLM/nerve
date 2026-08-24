import type { AgentToolSuspensionData } from "@nervekit/harness";
import type {
  CheckpointCommand,
  RunExecutionSink,
  WaitCommand,
} from "../../runs/runtime/index.js";
import {
  toolNameSchema,
  type AgentRecord,
  type ToolCallRecord,
} from "@nervekit/contracts";
import { toToolCallTranscriptRecord } from "../../tools/tool-call-transcript-preview.js";
import type { WorkbenchAgentMechanics } from "./workbench-agent-mechanics.js";
import { recordFromUnknown } from "./harness-execution-shared.js";

interface SequentialToolInteractionBatchInput {
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

export async function waitForSequentialToolInteractionBatch(
  input: SequentialToolInteractionBatchInput,
): Promise<void> {
  const { agent, runId, suspension, deps, sink } = input;
  const primaryToolCall = deps.tools.getToolCall(suspension.toolCallId);
  const toolCalls = [primaryToolCall];
  for (const remaining of suspension.remainingToolCalls ?? []) {
    const parsedToolName = toolNameSchema.safeParse(remaining.name);
    if (!parsedToolName.success) {
      throw new Error(`Unknown sequential tool: ${remaining.name}`);
    }
    if (
      isNativeInteractionTool(primaryToolCall.toolName) &&
      !isNativeInteractionTool(parsedToolName.data)
    ) {
      break;
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

  const primaryInteractionId = interactionIdForToolCall(primaryToolCall);
  const batchToolCallIds =
    toolCalls.length > 1 ? toolCalls.map((toolCall) => toolCall.id) : undefined;
  const checkpoint = await input.checkpointCommand(
    "suspension",
    primaryInteractionId,
  );
  const waits = toolCalls
    .filter((toolCall) => toolCall.status === "waiting")
    .map((toolCall) =>
      canonicalWaitCommand(
        interactionIdForToolCall(toolCall),
        toolCall,
        checkpoint,
        batchToolCallIds,
      ),
    );
  if (waits.length === 0) {
    await sink.wait(
      canonicalWaitCommand(
        primaryInteractionId,
        primaryToolCall,
        checkpoint,
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
  return ["waiting", "completed", "denied", "failed", "cancelled"].includes(
    toolCall.status,
  );
}

function isNativeInteractionTool(toolName: string): boolean {
  return toolName === "ask_user" || toolName === "plan_mode_present";
}

function interactionIdForToolCall(toolCall: ToolCallRecord): string {
  const pending = toolCall.interactions.find(
    (interaction) => interaction.status === "pending",
  );
  return pending ? `${toolCall.id}:${pending.ordinal}` : toolCall.id;
}

function canonicalWaitCommand(
  interactionId: string,
  toolCall: ToolCallRecord,
  checkpoint: CheckpointCommand,
  batchToolCallIds?: readonly string[],
): WaitCommand {
  const pending = toolCall.interactions.find(
    (interaction) => interaction.status === "pending",
  );
  if (!pending) {
    throw new Error(`Tool call ${toolCall.id} has no pending interaction.`);
  }
  return {
    kind: pending.kind,
    interactionId,
    toolCallId: toolCall.id,
    interactionOrdinal: pending.ordinal,
    toolCallRevision: toolCall.revision,
    batchToolCallIds,
    checkpoint,
  };
}
