import type { AgentMessage, JsonlSessionStorage } from "@nerve/agent";
import type { AgentRecord, SessionEntry, SessionRecord } from "@nerve/shared";
import type { EventBus } from "../events.js";
import { deriveSessionTitle } from "../session-operations/index.js";

export interface AppendEntryInput {
  id?: string;
  sessionId: string;
  agentId?: string;
  parentEntryId?: string | null;
  role: SessionEntry["role"];
  kind?: SessionEntry["kind"];
  text: string;
  summary?: string;
  tokensBefore?: number;
  firstKeptEntryId?: string;
  fromEntryId?: string;
  details?: unknown;
  createdAt?: string;
}

export type AppendEntryFn = (
  input: AppendEntryInput,
  options?: { mirrorToHarness?: boolean },
) => Promise<SessionEntry>;

export interface MessageMirrorDeps {
  entries: Map<string, SessionEntry[]>;
  sessions: Map<string, SessionRecord>;
  appendEntry: AppendEntryFn;
  updateSession: (session: SessionRecord) => Promise<void>;
  events: EventBus;
}

export class MessageMirror {
  constructor(private readonly deps: MessageMirrorDeps) {}

  async mirrorNewHarnessEntries(
    agent: AgentRecord,
    storage: JsonlSessionStorage,
    knownEntryIds: Set<string>,
  ): Promise<SessionEntry[]> {
    const mirrored: SessionEntry[] = [];
    for (const entry of await storage.getEntries()) {
      if (knownEntryIds.has(entry.id)) continue;
      knownEntryIds.add(entry.id);
      if (entry.type !== "message") continue;
      if (
        entry.message.role !== "user" &&
        entry.message.role !== "assistant" &&
        entry.message.role !== "toolResult"
      ) {
        continue;
      }
      const role: SessionEntry["role"] =
        entry.message.role === "toolResult" ? "system" : entry.message.role;
      const uiEntry = await this.deps.appendEntry(
        {
          id: entry.id,
          sessionId: agent.sessionId,
          agentId: agent.id,
          parentEntryId: entry.parentId,
          role,
          text: agentMessageText(entry.message as AgentMessage),
          details:
            entry.message.role === "toolResult"
              ? {
                  toolCallId: entry.message.toolCallId,
                  toolName: entry.message.toolName,
                  isError: entry.message.isError,
                  toolRecordId: toolRecordIdFromDetails(entry.message.details),
                  details: entry.message.details,
                }
              : undefined,
          createdAt: entry.timestamp,
        },
        { mirrorToHarness: false },
      );
      mirrored.push(uiEntry);
    }
    return mirrored;
  }

  async maybeDeriveInitialSessionTitle(
    sessionId: string,
    text: string,
  ): Promise<void> {
    const session = this.deps.sessions.get(sessionId);
    if (!session) return;
    const userEntryCount = (this.deps.entries.get(session.id) ?? []).filter(
      (entry) => entry.role === "user",
    ).length;
    if (userEntryCount !== 1) return;
    const title = deriveSessionTitle(text);
    if (!title || title === session.title) return;
    await this.deps.updateSession({
      ...session,
      title,
      updatedAt: new Date().toISOString(),
    });
    await this.deps.events.publish("session.updated", {
      session: this.deps.sessions.get(session.id),
    });
  }
}

function toolRecordIdFromDetails(details: unknown): string | undefined {
  if (!details || typeof details !== "object") return undefined;
  const toolCall = (details as { toolCall?: { id?: unknown } }).toolCall;
  return typeof toolCall?.id === "string" && toolCall.id.startsWith("tool_")
    ? toolCall.id
    : undefined;
}

export function agentMessageText(message: AgentMessage): string {
  if (message.role === "user") {
    if (typeof message.content === "string") return message.content;
    return message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");
  }
  if (message.role === "assistant") {
    const text = message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");
    if (text.trim()) return text;
    const toolCalls = message.content
      .filter((part) => part.type === "toolCall")
      .map((part) => `${part.name}(${JSON.stringify(part.arguments)})`);
    return toolCalls.length > 0 ? `[Tool call: ${toolCalls.join(", ")}]` : "";
  }
  if (message.role === "toolResult") {
    const text = message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");
    return text || `[Tool result: ${message.toolName}]`;
  }
  return "";
}
