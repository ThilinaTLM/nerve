import type { BashExecutionMessage } from "@nervekit/host-runtime/harness";
import type { ToolExecutionResult } from "@nervekit/host-runtime/tools";
import {
  formatInlineCommandResultText,
  type ToolCallRecord,
} from "@nervekit/contracts";
import { formatToolResultForModel } from "../../tools/agent-tool-adapter.js";

export function inlineCommandEntryDetails(
  toolCall: ToolCallRecord,
): Record<string, unknown> {
  return {
    type: "inline_command_result",
    command: commandFromToolCall(toolCall),
    toolCallId: toolCall.providerToolCallId ?? toolCall.sourceToolCallId,
    toolName: toolCall.toolName,
    isError: toolCallIsError(toolCall),
    toolRecordId: toolCall.id,
    details: {
      toolCall: { id: toolCall.id },
    },
  };
}

export function inlineCommandDisplayText(toolCall: ToolCallRecord): string {
  const exitCode = exitCodeFromToolCall(toolCall);
  return formatInlineCommandResultText({
    command: commandFromToolCall(toolCall),
    output: resultTextForToolCall(toolCall),
    status: toolCall.status,
    exitCode,
  });
}

export function inlineCommandExecutionResultText(
  command: string,
  result: ToolExecutionResult,
): string {
  return formatInlineCommandResultText({
    command,
    output: result.content || "(no output)",
    status: "completed",
    exitCode: result.exitCode,
  });
}

export function bashExecutionMessageForToolCall(
  toolCall: ToolCallRecord,
  timestamp: string,
): BashExecutionMessage {
  const details = resultDetails(toolCall);
  return {
    role: "bashExecution",
    command: commandFromToolCall(toolCall),
    output: resultTextForToolCall(toolCall),
    exitCode: exitCodeFromDetails(details),
    cancelled: false,
    truncated: Boolean(details?.truncation),
    fullOutputPath:
      typeof details?.fullOutputPath === "string"
        ? details.fullOutputPath
        : undefined,
    timestamp: new Date(timestamp).getTime(),
  };
}

function commandFromToolCall(toolCall: ToolCallRecord): string {
  const args = toolCall.args as Record<string, unknown> | undefined;
  return typeof args?.command === "string" ? args.command : "";
}

function resultTextForToolCall(toolCall: ToolCallRecord): string {
  if (toolCall.status !== "completed") {
    return toolCall.error ?? `Tool ${toolCall.toolName} ${toolCall.status}.`;
  }
  return formatToolResultForModel(toolCall);
}

function toolCallIsError(toolCall: ToolCallRecord): boolean {
  const exitCode = exitCodeFromToolCall(toolCall);
  return (
    toolCall.status !== "completed" ||
    (typeof exitCode === "number" && exitCode !== 0)
  );
}

function exitCodeFromToolCall(toolCall: ToolCallRecord): number | undefined {
  return exitCodeFromDetails(resultDetails(toolCall));
}

function resultDetails(
  toolCall: ToolCallRecord,
): Record<string, unknown> | undefined {
  const result = toolCall.result;
  if (!result || typeof result !== "object") return undefined;
  const details = (result as Record<string, unknown>).details;
  return details && typeof details === "object"
    ? (details as Record<string, unknown>)
    : undefined;
}

function exitCodeFromDetails(
  details: Record<string, unknown> | undefined,
): number | undefined {
  return typeof details?.exitCode === "number" ? details.exitCode : undefined;
}
