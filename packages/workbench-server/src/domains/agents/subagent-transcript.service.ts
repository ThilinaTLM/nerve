import { type ConversationTreeEntry } from "@nervekit/harness/conversation";
import { conversationStream } from "@nervekit/contracts/events";
import {
  SUBAGENT_TRANSCRIPT_MAX_ENTRIES,
  SUBAGENT_TRANSCRIPT_MAX_TEXT_CHARS,
  SUBAGENT_TRANSCRIPT_MAX_THINKING_BLOCKS,
  SUBAGENT_TRANSCRIPT_MAX_TOOL_CALLS,
  type AgentRecord,
  type SubagentTranscriptEntry,
  type SubagentTranscriptSnapshot,
} from "@nervekit/contracts/agents";
import { ApplicationError } from "../../core/application-error.js";
import { type InitializedStorage } from "../../infrastructure/storage-bootstrap/index.js";
import type { StreamLogRegistry } from "../../infrastructure/events/index.js";
import type { ConversationHarnessStorage } from "../conversations/conversation-harness-storage.js";
import type { ToolService } from "../tools/execution/tool-service.js";
import { projectHarnessMessageEntry } from "./execution/message-mirror.js";
import type { SubagentTranscriptLiveService } from "./subagent-transcript-live.service.js";

const MAX_PROJECTED_TEXT_CHARS = 2 * 1024 * 1024;

export interface SubagentTranscriptServiceDeps {
  storage: InitializedStorage;
  harnessStorage: ConversationHarnessStorage;
  tools: ToolService;
  getAgent: (agentId: string) => AgentRecord;
  events: StreamLogRegistry;
  live: SubagentTranscriptLiveService;
}

function modelLabel(agent: AgentRecord): string | undefined {
  if (!agent.model) return undefined;
  return `${agent.model.provider}/${agent.model.modelId}`;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

function boundedEntry(
  entry: ReturnType<typeof projectHarnessMessageEntry>,
): SubagentTranscriptEntry | undefined {
  if (!entry || !entry.agentId) return undefined;
  const details = entry.details as Record<string, unknown> | undefined;
  let boundedDetails: SubagentTranscriptEntry["details"];
  if (details && Array.isArray(details.thinkingBlocks)) {
    boundedDetails = {
      thinkingBlocks: details.thinkingBlocks
        .filter((block): block is { text: string; redacted?: boolean } =>
          Boolean(
            block &&
            typeof block === "object" &&
            typeof (block as { text?: unknown }).text === "string",
          ),
        )
        .slice(0, SUBAGENT_TRANSCRIPT_MAX_THINKING_BLOCKS)
        .map((block) => ({
          text: truncate(block.text, SUBAGENT_TRANSCRIPT_MAX_TEXT_CHARS),
          redacted: block.redacted,
        })),
      stopReason:
        details.stopReason === "error" || details.stopReason === "aborted"
          ? details.stopReason
          : undefined,
      errorMessage:
        typeof details.errorMessage === "string"
          ? truncate(details.errorMessage, 2_048)
          : undefined,
    };
  } else if (details && typeof details.isError === "boolean") {
    boundedDetails = {
      toolCallId:
        typeof details.toolCallId === "string"
          ? truncate(details.toolCallId, 512)
          : undefined,
      toolRecordId:
        typeof details.toolRecordId === "string" &&
        details.toolRecordId.startsWith("tool_")
          ? details.toolRecordId
          : undefined,
      toolName:
        typeof details.toolName === "string"
          ? truncate(details.toolName, 128)
          : undefined,
      status: details.isError ? "error" : "completed",
      isError: details.isError,
      outputOmitted: details.isError ? undefined : true,
    };
  }
  return {
    id: truncate(entry.id, 512),
    conversationId: entry.conversationId,
    agentId: entry.agentId,
    role: entry.role,
    kind: "message",
    text: truncate(entry.text, SUBAGENT_TRANSCRIPT_MAX_TEXT_CHARS),
    usage: entry.usage,
    details: boundedDetails,
    createdAt: entry.createdAt,
  };
}

function textSize(entry: SubagentTranscriptEntry): number {
  const thinking =
    entry.details && "thinkingBlocks" in entry.details
      ? (entry.details.thinkingBlocks ?? []).reduce(
          (sum, block) => sum + block.text.length,
          0,
        )
      : 0;
  return entry.text.length + thinking;
}

function boundedTail(
  entries: SubagentTranscriptEntry[],
): SubagentTranscriptEntry[] {
  if (entries.length === 0) return [];
  const firstAssignment = entries.find((entry) => entry.role === "user");
  const selected: SubagentTranscriptEntry[] = [];
  const tailLimit = SUBAGENT_TRANSCRIPT_MAX_ENTRIES - (firstAssignment ? 1 : 0);
  let size = firstAssignment ? textSize(firstAssignment) : 0;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!entry || entry === firstAssignment) continue;
    const nextSize = textSize(entry);
    if (selected.length >= tailLimit) break;
    if (size + nextSize > MAX_PROJECTED_TEXT_CHARS) break;
    selected.push(entry);
    size += nextSize;
  }
  selected.reverse();
  if (firstAssignment) selected.unshift(firstAssignment);
  return selected.slice(-SUBAGENT_TRANSCRIPT_MAX_ENTRIES);
}

function messageEntries(
  entries: ConversationTreeEntry[],
): Array<Extract<ConversationTreeEntry, { type: "message" }>> {
  return entries.filter(
    (entry): entry is Extract<ConversationTreeEntry, { type: "message" }> =>
      entry.type === "message",
  );
}

export class SubagentTranscriptService {
  constructor(private readonly deps: SubagentTranscriptServiceDeps) {}

  async get(
    parentAgentId: string,
    childAgentId: string,
  ): Promise<SubagentTranscriptSnapshot> {
    const parent = this.deps.getAgent(parentAgentId);
    const child = this.deps.getAgent(childAgentId);
    if (
      child.parentAgentId !== parent.id ||
      child.conversationId !== parent.conversationId ||
      child.projectId !== parent.projectId ||
      child.rootAgentId !== parent.rootAgentId
    ) {
      throw new ApplicationError(
        404,
        "SUBAGENT_TRANSCRIPT_NOT_FOUND",
        "Subagent transcript not found.",
      );
    }

    const captured = await this.deps.events.withCursor(
      conversationStream(child.conversationId),
      async () => {
        const parentIds = new Set(
          (
            await this.deps.harnessStorage.modelEntries(parent.conversationId)
          ).map((entry) => entry.id),
        );
        const projected = messageEntries(
          await this.deps.harnessStorage.modelEntries(
            child.conversationId,
            child.id,
          ),
        )
          .filter((entry) => !parentIds.has(entry.id))
          .map((entry) =>
            boundedEntry(
              projectHarnessMessageEntry({
                entry,
                conversationId: child.conversationId,
                agentId: child.id,
              }),
            ),
          )
          .filter((entry): entry is SubagentTranscriptEntry => Boolean(entry));

        const allToolCalls = (
          await this.deps.tools.listToolCallPreviews({
            agentId: child.id,
            limit: 1_000,
          })
        ).sort((a, b) =>
          a.createdAt === b.createdAt
            ? a.id.localeCompare(b.id)
            : a.createdAt.localeCompare(b.createdAt),
        );
        const toolCalls = allToolCalls.slice(
          -SUBAGENT_TRANSCRIPT_MAX_TOOL_CALLS,
        );
        const entries = boundedTail(projected);
        const updatedAt = [
          child.updatedAt,
          entries.at(-1)?.createdAt,
          toolCalls.at(-1)?.updatedAt,
        ]
          .filter((value): value is string => Boolean(value))
          .sort()
          .at(-1)!;

        return {
          agentId: child.id,
          parentAgentId: parent.id,
          conversationId: child.conversationId,
          projectId: child.projectId,
          activeRun: this.deps.live.snapshot(child.id),
          status: child.status,
          model: modelLabel(child),
          thinkingLevel: child.thinkingLevel,
          entries,
          toolCalls,
          totalEntryCount: projected.length,
          totalToolCallCount: allToolCalls.length,
          entriesTruncated: entries.length < projected.length,
          toolCallsTruncated: toolCalls.length < allToolCalls.length,
          updatedAt,
        };
      },
    );
    return {
      ...captured.value,
      cursorSeq: captured.cursor.processedSeq,
    };
  }
}
