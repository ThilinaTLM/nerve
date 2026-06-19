import type { ImageContent, Message, TextContent } from "@earendil-works/pi-ai";
import type { TaskReadiness, TaskStatus } from "@nerve/shared";
import type { AgentMessage } from "../types.js";

export const COMPACTION_SUMMARY_PREFIX = `The conversation history before this point was compacted into the following summary:

<summary>
`;

export const COMPACTION_SUMMARY_SUFFIX = `
</summary>`;

export const BRANCH_SUMMARY_PREFIX = `The following is a summary of a branch that this conversation came back from:

<summary>
`;

export const BRANCH_SUMMARY_SUFFIX = `</summary>`;

export interface BashExecutionMessage {
  role: "bashExecution";
  command: string;
  output: string;
  exitCode: number | undefined;
  cancelled: boolean;
  truncated: boolean;
  fullOutputPath?: string;
  timestamp: number;
  excludeFromContext?: boolean;
}

export interface CustomMessage<T = unknown> {
  role: "custom";
  customType: string;
  content: string | (TextContent | ImageContent)[];
  display: boolean;
  details?: T;
  timestamp: number;
}

export type HarnessTaskEvent =
  | "ready"
  | "completed"
  | "failed"
  | "timed_out"
  | "cancelled"
  | "orphaned";

export interface HarnessTaskEventDetails {
  taskId: string;
  taskName?: string;
  groupId?: string;
  groupName?: string;
  event: HarnessTaskEvent;
  status: TaskStatus;
  readiness?: TaskReadiness;
  exitCode?: number | null;
  signal?: string | null;
  nextCursor?: number;
  commandPreview?: string;
  notificationEntryId?: string;
}

export interface HarnessMessage<T = unknown> {
  role: "harness";
  eventType: string;
  content: string;
  details?: T;
  timestamp: number;
}

export interface BranchSummaryMessage {
  role: "branchSummary";
  summary: string;
  fromId: string;
  timestamp: number;
}

export interface CompactionSummaryMessage {
  role: "compactionSummary";
  summary: string;
  tokensBefore: number;
  timestamp: number;
}

declare module "../types.js" {
  interface CustomAgentMessages {
    bashExecution: BashExecutionMessage;
    custom: CustomMessage;
    harness: HarnessMessage;
    branchSummary: BranchSummaryMessage;
    compactionSummary: CompactionSummaryMessage;
  }
}

export function bashExecutionToText(msg: BashExecutionMessage): string {
  let text = `Ran \`${msg.command}\`\n`;
  if (msg.output) {
    text += `\`\`\`\n${msg.output}\n\`\`\``;
  } else {
    text += "(no output)";
  }
  if (msg.cancelled) {
    text += "\n\n(command cancelled)";
  } else if (
    msg.exitCode !== null &&
    msg.exitCode !== undefined &&
    msg.exitCode !== 0
  ) {
    text += `\n\nCommand exited with code ${msg.exitCode}`;
  }
  if (msg.truncated && msg.fullOutputPath) {
    text += `\n\n[Output truncated. Full output: ${msg.fullOutputPath}]`;
  }
  return text;
}

export function createBranchSummaryMessage(
  summary: string,
  fromId: string,
  timestamp: string,
): BranchSummaryMessage {
  return {
    role: "branchSummary",
    summary,
    fromId,
    timestamp: new Date(timestamp).getTime(),
  };
}

export function createCompactionSummaryMessage(
  summary: string,
  tokensBefore: number,
  timestamp: string,
): CompactionSummaryMessage {
  return {
    role: "compactionSummary",
    summary,
    tokensBefore,
    timestamp: new Date(timestamp).getTime(),
  };
}

export function createCustomMessage(
  customType: string,
  content: string | (TextContent | ImageContent)[],
  display: boolean,
  details: unknown | undefined,
  timestamp: string,
): CustomMessage {
  return {
    role: "custom",
    customType,
    content,
    display,
    details,
    timestamp: new Date(timestamp).getTime(),
  };
}

export function createHarnessMessage<T = unknown>(
  eventType: string,
  content: string,
  details: T | undefined,
  timestamp: string,
): HarnessMessage<T> {
  return {
    role: "harness",
    eventType,
    content,
    details,
    timestamp: new Date(timestamp).getTime(),
  };
}

function harnessMessageToText(message: HarnessMessage): string {
  if (message.eventType === "task_event") {
    return [
      "<background_task_update>",
      "This is an asynchronous harness event, not a user request.",
      message.content,
      "</background_task_update>",
    ].join("\n");
  }
  return [
    "<harness_event>",
    "This is an asynchronous harness event, not a user request.",
    message.content,
    "</harness_event>",
  ].join("\n");
}

export function convertToLlm(messages: AgentMessage[]): Message[] {
  return messages
    .map((m): Message | undefined => {
      switch (m.role) {
        case "bashExecution":
          if (m.excludeFromContext) {
            return undefined;
          }
          return {
            role: "user",
            content: [{ type: "text", text: bashExecutionToText(m) }],
            timestamp: m.timestamp,
          };
        case "custom": {
          const content =
            typeof m.content === "string"
              ? [{ type: "text" as const, text: m.content }]
              : m.content;
          return {
            role: "user",
            content,
            timestamp: m.timestamp,
          };
        }
        case "harness":
          return {
            role: "user",
            content: [{ type: "text" as const, text: harnessMessageToText(m) }],
            timestamp: m.timestamp,
          };
        case "branchSummary":
          return {
            role: "user",
            content: [
              {
                type: "text" as const,
                text: BRANCH_SUMMARY_PREFIX + m.summary + BRANCH_SUMMARY_SUFFIX,
              },
            ],
            timestamp: m.timestamp,
          };
        case "compactionSummary":
          return {
            role: "user",
            content: [
              {
                type: "text" as const,
                text:
                  COMPACTION_SUMMARY_PREFIX +
                  m.summary +
                  COMPACTION_SUMMARY_SUFFIX,
              },
            ],
            timestamp: m.timestamp,
          };
        case "user":
        case "assistant":
        case "toolResult":
          return m;
        default:
          return undefined;
      }
    })
    .filter((m): m is Message => m !== undefined);
}
