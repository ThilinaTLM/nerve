import { toolCallRecordSchema } from "@nervekit/contracts/tools";
import { type ConversationTreeEntry } from "@nervekit/harness/conversation";
import { conversationStream } from "@nervekit/contracts/events";
import {
  agentHistoryResultSchema,
  effectiveTurnConfigurationSchema,
  type AgentCompletion,
  type AgentHistoryResult,
  SUBAGENT_TRANSCRIPT_MAX_ENTRIES,
  SUBAGENT_TRANSCRIPT_MAX_TEXT_CHARS,
  SUBAGENT_TRANSCRIPT_MAX_THINKING_BLOCKS,
  SUBAGENT_TRANSCRIPT_MAX_TOOL_CALLS,
  type AgentActivitySnapshot,
  type AgentRecord,
  type SubagentTranscriptEntry,
  type SubagentTranscriptSnapshot,
} from "@nervekit/contracts/agents";
import { ApplicationError } from "../../core/application-error.js";
import type {
  ConversationActiveRunSnapshot,
  ConversationEntry,
} from "@nervekit/contracts/conversations";
import { type InitializedStorage } from "../../infrastructure/storage-bootstrap/index.js";
import type { StreamLogRegistry } from "../../infrastructure/events/index.js";
import type { ConversationHarnessStorage } from "../conversations/conversation-harness-storage.js";
import type { ToolService } from "../tools/execution/tool-service.js";
import { projectHarnessMessageEntry } from "./execution/message-mirror.js";
import { resolveCompactionOwner } from "../conversations/compaction-owner.js";
import { validateModelHistoryPath } from "../conversations/model-history-navigation.js";

const MAX_PROJECTED_TEXT_CHARS = 2 * 1024 * 1024;

export interface SubagentTranscriptServiceDeps {
  storage: InitializedStorage;
  harnessStorage: ConversationHarnessStorage;
  tools: ToolService;
  getAgent: (agentId: string) => AgentRecord;
  events: StreamLogRegistry;
  /** Live run of the child: explore projection or shared background run. */
  activeRun: (
    childAgentId: string,
  ) => ConversationActiveRunSnapshot | undefined;
  activityForAgent(agentId: string): Promise<AgentActivitySnapshot>;
  latestCompletion(agentId: string): Promise<AgentCompletion | null>;
  turnConfigurations?(agentId: string): Promise<readonly unknown[]>;
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

  /** Normal user history is selected by persistent agent identity, not parentage. */
  async history(agentId: string): Promise<ConversationEntry[]> {
    const agent = this.deps.getAgent(agentId);
    const canonical =
      await this.deps.storage.canonicalStore.readConversationEntries(
        agent.conversationId,
      );
    const owner = resolveCompactionOwner(
      agent.conversationId,
      agent,
    ).ownerAgentId;
    const context = await this.deps.harnessStorage.modelEntries(
      agent.conversationId,
      owner,
    );
    const owned = new Map(context.map((entry) => [entry.id, entry]));
    const selected = new Map<string, ConversationEntry>();
    for (const entry of canonical) {
      const model = owned.get(entry.id);
      if (
        entry.agentId !== agent.id &&
        !model &&
        !(agent.contextOwnerAgentId === null && !entry.agentId)
      )
        continue;
      if (entry.agentId === agent.id || !model) {
        selected.set(entry.id, entry);
        continue;
      }
      const projected =
        model.type === "message"
          ? projectHarnessMessageEntry({
              entry: model,
              conversationId: agent.conversationId,
              agentId: agent.id,
            })
          : model.type === "compaction" || model.type === "branch_summary"
            ? {
                text: model.summary,
                summary: model.summary,
                ...(model.type === "compaction"
                  ? {
                      tokensBefore: model.tokensBefore,
                      firstKeptEntryId: model.firstKeptEntryId,
                    }
                  : {}),
              }
            : undefined;
      const details =
        model.type === "message" &&
        projected &&
        "details" in projected &&
        projected.details &&
        typeof projected.details === "object"
          ? projected.details
          : {};
      // A frozen migration prefix belongs to this context; preserve author
      // provenance without following the sibling's later/live history.
      selected.set(entry.id, {
        ...entry,
        ...projected,
        ...(model.type === "message" && model.message.role === "toolResult"
          ? {
              text: model.message.content
                .filter((block) => block.type === "text")
                .map((block) => block.text)
                .join("\n"),
            }
          : {}),
        parentEntryId: model.parentId ?? undefined,
        agentId: agent.id,
        details: {
          ...details,
          ...(model.type === "message" && model.message.role === "toolResult"
            ? {
                outputOmitted: false,
                capturedToolResult: model.message.details,
              }
            : {}),
          sourceAgentId: entry.agentId,
          contextOwnerAgentId: agent.id,
          provenance: "historical_context_prefix",
        },
      });
    }
    for (const entry of context) {
      if (selected.has(entry.id)) continue;
      const projected =
        entry.type === "message"
          ? projectHarnessMessageEntry({
              entry,
              conversationId: agent.conversationId,
              agentId: agent.id,
            })
          : entry.type === "compaction" || entry.type === "branch_summary"
            ? {
                id: entry.id,
                conversationId: agent.conversationId,
                agentId: agent.id,
                role: "system" as const,
                kind: "compaction" as const,
                text: entry.summary,
                summary: entry.summary,
                createdAt: entry.timestamp,
                ...(entry.type === "compaction"
                  ? {
                      tokensBefore: entry.tokensBefore,
                      firstKeptEntryId: entry.firstKeptEntryId,
                    }
                  : {}),
              }
            : undefined;
      if (projected)
        selected.set(entry.id, {
          ...projected,
          ...(entry.type === "message" && entry.message.role === "toolResult"
            ? {
                text: entry.message.content
                  .filter((block) => block.type === "text")
                  .map((block) => block.text)
                  .join("\n"),
                details: {
                  ...(projected.details && typeof projected.details === "object"
                    ? projected.details
                    : {}),
                  capturedToolResult: entry.message.details,
                  outputOmitted: false,
                  provenance: "model_context",
                },
              }
            : {}),
          parentEntryId: entry.parentId ?? undefined,
        });
    }
    return [...selected.values()].sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    );
  }

  async snapshot(agentId: string): Promise<AgentHistoryResult> {
    const agent = this.deps.getAgent(agentId);
    const captured = await this.deps.events.withCursor(
      conversationStream(agent.conversationId),
      async () => {
        const entries = await this.history(agentId);
        const ids = new Set<string>();
        let cursor: { updatedAt: string; id: string } | undefined;
        do {
          const page = await this.deps.tools.queryToolCallPreviews({
            agentId,
            limit: 200,
            cursor,
          });
          for (const preview of page.toolCalls) ids.add(preview.id);
          cursor = page.nextCursor;
        } while (cursor);
        const toolCalls = [];
        for (const id of ids) {
          const record = await this.deps.tools.getToolCallDetails(id);
          if (
            record.agentId !== agentId ||
            record.conversationId !== agent.conversationId
          )
            throw new Error(
              "History tool record is outside the selected agent scope",
            );
          toolCalls.push(record);
        }
        // Inherited prefix results are immutable copies, never live foreign queries.
        for (const entry of entries) {
          const details =
            entry.details && typeof entry.details === "object"
              ? (entry.details as Record<string, unknown>)
              : undefined;
          if (
            !details ||
            !["historical_context_prefix", "model_context"].includes(
              String(details.provenance),
            ) ||
            entry.kind !== "tool_result"
          )
            continue;
          const frozen = details.capturedToolResult;
          const record = toolCallRecordSchema.safeParse(
            frozen && typeof frozen === "object"
              ? (frozen as { toolCall?: unknown }).toolCall
              : undefined,
          );
          if (
            record.success &&
            record.data.conversationId === agent.conversationId &&
            ["completed", "error", "cancelled"].includes(record.data.status) &&
            !ids.has(record.data.id)
          ) {
            toolCalls.push(record.data);
            ids.add(record.data.id);
          }
        }
        const effectiveConfiguration =
          ((await this.deps.turnConfigurations?.(agentId)) ?? [])
            .map((value) => effectiveTurnConfigurationSchema.safeParse(value))
            .filter((result) => result.success)
            .map((result) => result.data)
            .filter((turn) => turn.agentId === agentId)
            .at(-1) ?? null;
        const owner = resolveCompactionOwner(
          agent.conversationId,
          agent,
        ).ownerAgentId;
        const modelEntries = await this.deps.harnessStorage.modelEntries(
          agent.conversationId,
          owner,
        );
        const modelById = new Map(
          modelEntries.map((entry) => [entry.id, entry]),
        );
        const modelStorage =
          await this.deps.harnessStorage.openAgentStorage?.(agent);
        const activeEntryId = modelStorage
          ? await modelStorage.getLeafId()
          : null;
        const activeEntryIds = validateModelHistoryPath(
          modelById,
          activeEntryId,
        ).map((entry) => entry.id);
        return {
          agentId,
          conversationId: agent.conversationId,
          entries,
          activeEntryId,
          activeEntryIds,
          toolCalls,
          latestCompletion: await this.deps.latestCompletion(agentId),
          effectiveConfiguration,
          activeRun: this.deps.activeRun(agentId),
          activity: await this.deps.activityForAgent(agentId),
        };
      },
    );
    return agentHistoryResultSchema.parse({
      ...captured.value,
      cursorSeq: captured.cursor.processedSeq,
    });
  }

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
            await this.deps.harnessStorage.modelEntries(
              parent.conversationId,
              resolveCompactionOwner(parent.conversationId, parent)
                .ownerAgentId,
            )
          ).map((entry) => entry.id),
        );
        const projected = messageEntries(
          await this.deps.harnessStorage.modelEntries(
            child.conversationId,
            resolveCompactionOwner(child.conversationId, child).ownerAgentId,
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
        const activity = await this.deps.activityForAgent(child.id);
        const updatedAt = [
          child.updatedAt,
          activity.updatedAt,
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
          activeRun: this.deps.activeRun(child.id),
          status: activity.state,
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
