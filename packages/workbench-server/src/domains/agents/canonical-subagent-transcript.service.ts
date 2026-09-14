import { conversationStream } from "@nervekit/contracts/events";
import type {
  AgentRecord,
  SubagentTranscriptSnapshot,
} from "@nervekit/contracts/agents";
import type { StreamLogRegistry } from "../../infrastructure/events/index.js";
import type { CanonicalConversationApplicationService } from "../conversations/timeline/canonical-conversation-application.service.js";
import type { CanonicalToolApplicationService } from "../tools/execution/canonical-tool-application.service.js";
import type { SubagentTranscriptLiveService } from "./subagent-transcript-live.service.js";

/** Subagent view rebuilt from canonical conversation entries and tool effects. */
export class CanonicalSubagentTranscriptService {
  constructor(
    private readonly deps: {
      getAgent(agentId: string): AgentRecord;
      conversations: CanonicalConversationApplicationService;
      tools: CanonicalToolApplicationService;
      events: StreamLogRegistry;
      live: SubagentTranscriptLiveService;
    },
  ) {}

  async get(
    parentAgentId: string,
    childAgentId: string,
  ): Promise<SubagentTranscriptSnapshot> {
    const parent = this.deps.getAgent(parentAgentId);
    const child = this.deps.getAgent(childAgentId);
    if (
      child.parentAgentId !== parent.id ||
      child.conversationId !== parent.conversationId
    ) {
      throw new Error("Subagent transcript not found.");
    }
    const captured = await this.deps.events.withCursor(
      conversationStream(child.conversationId),
      async () => {
        const entries = (
          await this.deps.conversations.ensureConversationEntries(
            child.conversationId,
          )
        )
          .filter((entry) => entry.agentId === child.id)
          .map((entry) => ({
            id: entry.id,
            conversationId: entry.conversationId,
            agentId: child.id,
            role: entry.role,
            kind: "message" as const,
            text: entry.text,
            createdAt: entry.createdAt,
            ...(entry.usage ? { usage: entry.usage } : {}),
          }));
        const toolCalls = await this.deps.tools.listToolCallPreviews({
          conversationId: child.conversationId,
          limit: 1_000,
        });
        return {
          agentId: child.id,
          parentAgentId: parent.id,
          conversationId: child.conversationId,
          projectId: child.projectId,
          activeRun: this.deps.live.snapshot(child.id),
          status: child.status,
          model: child.model
            ? `${child.model.provider}/${child.model.modelId}`
            : undefined,
          thinkingLevel: child.thinkingLevel,
          entries,
          toolCalls: toolCalls.filter((tool) => tool.agentId === child.id),
          totalEntryCount: entries.length,
          totalToolCallCount: toolCalls.length,
          entriesTruncated: false,
          toolCallsTruncated: false,
          updatedAt: child.updatedAt,
        };
      },
    );
    return { ...captured.value, cursorSeq: captured.cursor.processedSeq };
  }
}
