import type { BashExecutionMessage } from "@nervekit/agent";
import type { ToolCallRecord } from "@nervekit/shared";
import type { ToolExecutionResult } from "@nervekit/tools";
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
      toolCall,
      result: toolCall.result,
    },
  };
}

export function inlineCommandDisplayText(toolCall: ToolCallRecord): string {
  const exitCode = exitCodeFromToolCall(toolCall);
  return inlineCommandResultText({
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
  return inlineCommandResultText({
    command,
    output: result.content || "(no output)",
    status: "completed",
    exitCode: result.exitCode,
  });
}

type InlineCommandResultTextInput = {
  command: string;
  output: string;
  status: string;
  exitCode?: number;
};

function inlineCommandResultText(input: InlineCommandResultTextInput): string {
  const statusLine = [
    typeof input.exitCode === "number"
      ? `exit code: ${input.exitCode}`
      : undefined,
    `status: ${input.status}`,
  ]
    .filter(Boolean)
    .join(", ");

  return fenced(
    [
      formatCommandTranscript(input.command),
      "",
      `> ${statusLine}`,
      input.output || "(no output)",
    ].join("\n"),
    "",
  );
}

function formatCommandTranscript(command: string): string {
  const lines = (command || "(empty command)").split(/\r?\n/);
  return lines
    .map((line, index) => (index === 0 ? `$ ${line}` : line))
    .join("\n");
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

function fenced(text: string, info: string): string {
  const fence =
    longestBacktickRun(text) >= 3
      ? "`".repeat(longestBacktickRun(text) + 1)
      : "```";
  return `${fence}${info}\n${text}\n${fence}`;
}

function longestBacktickRun(text: string): number {
  return Math.max(
    0,
    ...Array.from(text.matchAll(/`+/g), (match) => match[0].length),
  );
}
