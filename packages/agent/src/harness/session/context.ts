import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import type { AgentMessage } from "../../types.js";
import {
  createBranchSummaryMessage,
  createCompactionSummaryMessage,
  createCustomMessage,
} from "../messages.js";
import type { CompactionEntry, SessionTreeEntry } from "./entries.js";

export interface SessionContext {
  messages: AgentMessage[];
  thinkingLevel: string;
  model: { provider: string; modelId: string } | null;
  activeToolNames: string[] | null;
}

export interface SessionState {
  thinkingLevel: string;
  model: { provider: string; modelId: string } | null;
  activeToolNames: string[] | null;
  compaction: CompactionEntry | null;
}

export function extractSessionState(pathEntries: SessionTreeEntry[]): SessionState {
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

function messageFromEntry(entry: SessionTreeEntry): AgentMessage | undefined {
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
    return createBranchSummaryMessage(entry.summary, entry.fromId, entry.timestamp);
  }
  return undefined;
}

function appendContextMessage(messages: AgentMessage[], entry: SessionTreeEntry): void {
  const message = messageFromEntry(entry);
  if (message) messages.push(message);
}

export function buildContextMessages(
  pathEntries: SessionTreeEntry[],
  state: SessionState,
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
      (entry) => entry.type === "compaction" && entry.id === state.compaction?.id,
    );
    let foundFirstKept = false;
    for (let i = 0; i < compactionIdx; i++) {
      const entry = pathEntries[i]!;
      if (entry.id === state.compaction.firstKeptEntryId) foundFirstKept = true;
      if (foundFirstKept) appendContextMessage(messages, entry);
    }
    for (let i = compactionIdx + 1; i < pathEntries.length; i++) {
      appendContextMessage(messages, pathEntries[i]!);
    }
    return messages;
  }

  for (const entry of pathEntries) {
    appendContextMessage(messages, entry);
  }
  return messages;
}

export function buildSessionContext(pathEntries: SessionTreeEntry[]): SessionContext {
  const state = extractSessionState(pathEntries);
  return {
    messages: buildContextMessages(pathEntries, state),
    thinkingLevel: state.thinkingLevel,
    model: state.model,
    activeToolNames: state.activeToolNames,
  };
}
