import type { AgentRecord } from "@nervekit/contracts/agents";
import type { ConversationEntry } from "@nervekit/contracts/conversations";
import {
  Conversation,
  type ConversationStorage,
} from "@nervekit/harness/conversation";
import { projectHarnessMessageEntry } from "./canonical-harness-projection.js";
import type {
  CanonicalRunExecutionBoundary,
  CanonicalRunExecutionSession,
} from "./canonical-run-execution-boundary.js";

export async function openHarnessExecutionContext(input: {
  canonical?: CanonicalRunExecutionSession;
  openLegacy(): Promise<ConversationStorage>;
}): Promise<[ConversationStorage, Conversation, Set<string>]> {
  const storage = input.canonical?.storage ?? (await input.openLegacy());
  return [
    storage,
    input.canonical?.conversation ?? new Conversation(storage),
    input.canonical?.materializedEntryIds ??
      new Set((await storage.getEntries()).map((entry) => entry.id)),
  ];
}

/** Flushes ephemeral messages without invoking any legacy persistence adapter. */
export async function flushCanonicalHarnessMessages(input: {
  agent: AgentRecord;
  session: CanonicalRunExecutionSession;
  boundary: CanonicalRunExecutionBoundary;
  now: string;
}): Promise<ConversationEntry[]> {
  const pending = (await input.session.storage.getEntries()).filter(
    (entry) =>
      entry.type === "message" &&
      !input.session.materializedEntryIds.has(entry.id),
  );
  const projected = pending.flatMap((entry) => {
    if (entry.type !== "message") return [];
    const value = projectHarnessMessageEntry({
      entry,
      conversationId: input.agent.conversationId,
      agentId: input.agent.id,
    });
    return value ? [value] : [];
  });
  const flushed = await input.boundary.flush(input.session, input.now);
  if (flushed.kind === "rejected") {
    throw new Error(
      `Canonical harness flush rejected: ${flushed.outcome.kind}.`,
    );
  }
  return projected;
}
