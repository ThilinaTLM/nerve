import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import type { AgentMessage } from "../../types.js";
import {
  createBranchSummaryMessage,
  createCompactionSummaryMessage,
  createCustomMessage,
} from "../messages.js";
import type { CompactionEntry, ConversationTreeEntry } from "./entries.js";

export interface ConversationContext {
  messages: AgentMessage[];
  thinkingLevel: string;
  model: { provider: string; modelId: string } | null;
  activeToolNames: string[] | null;
}

export interface ConversationState {
  thinkingLevel: string;
  model: { provider: string; modelId: string } | null;
  activeToolNames: string[] | null;
  compaction: CompactionEntry | null;
}

export function extractConversationState(
  pathEntries: ConversationTreeEntry[],
): ConversationState {
  let thinkingLevel = "off";
  let model: { provider: string; modelId: string } | null = null;
  let activeToolNames: string[] | null = null;
  let compaction: CompactionEntry | null = null;

  for (const entry of pathEntries) {
    if (entry.type === "thinking_level_change") {
      thinkingLevel = entry.thinkingLevel;
    } else if (entry.type === "model_change") {
      model = { provider: entry.provider, modelId: entry.modelId };
    } else if (entry.type === "message" && entry.message.role === "assistant") {
      model = {
        provider: entry.message.provider,
        modelId: entry.message.model,
      };
    } else if (entry.type === "active_tools_change") {
      activeToolNames = [...entry.activeToolNames];
    } else if (entry.type === "compaction") {
      compaction = entry;
    }
  }

  return { thinkingLevel, model, activeToolNames, compaction };
}

function messageFromEntry(
  entry: ConversationTreeEntry,
): AgentMessage | undefined {
  if (entry.type === "message") return entry.message as AgentMessage;
  if (entry.type === "custom_message") {
    return createCustomMessage(
      entry.customType,
      entry.content as string | (TextContent | ImageContent)[],
      entry.display,
      entry.details,
      entry.timestamp,
    );
  }
  if (entry.type === "branch_summary" && entry.summary) {
    return createBranchSummaryMessage(
      entry.summary,
      entry.fromId,
      entry.timestamp,
    );
  }
  return undefined;
}

function appendContextMessage(
  messages: AgentMessage[],
  entry: ConversationTreeEntry,
): void {
  const message = messageFromEntry(entry);
  if (message) messages.push(message);
}

export function buildContextMessages(
  pathEntries: ConversationTreeEntry[],
  state: ConversationState,
): AgentMessage[] {
  const messages: AgentMessage[] = [];

  if (state.compaction) {
    messages.push(
      createCompactionSummaryMessage(
        state.compaction.summary,
        state.compaction.tokensBefore,
        state.compaction.timestamp,
      ),
    );
    const compactionIdx = pathEntries.findIndex(
      (entry) =>
        entry.type === "compaction" && entry.id === state.compaction?.id,
    );
    let foundFirstKept = false;
    for (const entry of pathEntries.slice(0, compactionIdx)) {
      if (entry.id === state.compaction.firstKeptEntryId) foundFirstKept = true;
      if (foundFirstKept) appendContextMessage(messages, entry);
    }
    for (const entry of pathEntries.slice(compactionIdx + 1)) {
      appendContextMessage(messages, entry);
    }
    return messages;
  }

  for (const entry of pathEntries) {
    appendContextMessage(messages, entry);
  }
  return messages;
}

export function buildConversationContext(
  pathEntries: ConversationTreeEntry[],
): ConversationContext {
  const state = extractConversationState(pathEntries);
  return {
    messages: buildContextMessages(pathEntries, state),
    thinkingLevel: state.thinkingLevel,
    model: state.model,
    activeToolNames: state.activeToolNames,
  };
}
