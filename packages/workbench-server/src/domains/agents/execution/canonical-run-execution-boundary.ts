import { createHash } from "node:crypto";
import type { AgentMessage } from "@nervekit/harness/agent";
import {
  Conversation,
  type ConversationStorage,
  type ConversationTreeEntry,
} from "@nervekit/harness/conversation";
import type { MutationOutcome } from "@nervekit/contracts/conversations";
import { CanonicalConversationContextService } from "../../conversations/timeline/canonical-conversation-context.service.js";
import { CanonicalRunStartService } from "../../conversations/timeline/canonical-run-start.service.js";
import { CanonicalRunTimelineService } from "../../conversations/timeline/canonical-run-timeline.service.js";
import { CanonicalRunTerminationService } from "../../conversations/timeline/canonical-run-termination.service.js";
import { canonicalConversationJson } from "../../conversations/timeline/command-fingerprint.js";
import { createCanonicalHarnessContext } from "./canonical-harness-context.js";
import { projectHarnessCanonicalEntry } from "./message-mirror.js";

export interface CanonicalRunExecutionSession {
  conversationId: string;
  runId: string;
  agentId: string;
  storage: ConversationStorage;
  conversation: Conversation;
  materializedEntryIds: Set<string>;
}

export type CanonicalExecutionBoundaryResult<T> =
  | { kind: "ready"; value: T }
  | { kind: "rejected"; outcome: MutationOutcome };

/**
 * Sole bridge between an ephemeral harness tree and canonical run mutations.
 * Harness entries have no durable authority until flush() commits them.
 */
export class CanonicalRunExecutionBoundary {
  constructor(
    private readonly starts: CanonicalRunStartService,
    private readonly contexts: CanonicalConversationContextService,
    private readonly timeline: CanonicalRunTimelineService,
    private readonly termination: CanonicalRunTerminationService,
  ) {}

  async begin(input: {
    conversationId: string;
    runId: string;
    agentId: string;
    prompt: string;
    images?: readonly unknown[];
    providerIdentity: Record<string, unknown>;
    providerCapability:
      | "stateless_generation"
      | "contractually_replay_safe"
      | "non_repeatable_or_unknown";
    conversationCreatedAt: string;
    now: string;
  }): Promise<CanonicalExecutionBoundaryResult<CanonicalRunExecutionSession>> {
    const started = await this.starts.start(input);
    if (started.kind === "rejected") return started;
    const context = await this.contexts.build({
      conversationId: input.conversationId,
      runId: input.runId,
    });
    if (context.kind !== "ready") {
      return { kind: "rejected", outcome: context.outcome };
    }
    return readySession({
      conversationId: input.conversationId,
      runId: input.runId,
      agentId: input.agentId,
      conversationCreatedAt: input.conversationCreatedAt,
      snapshot: context.snapshot,
    });
  }

  async resume(input: {
    conversationId: string;
    runId: string;
    agentId: string;
    conversationCreatedAt: string;
  }): Promise<CanonicalExecutionBoundaryResult<CanonicalRunExecutionSession>> {
    const context = await this.contexts.build({
      conversationId: input.conversationId,
      runId: input.runId,
    });
    return context.kind === "ready"
      ? readySession({ ...input, snapshot: context.snapshot })
      : { kind: "rejected", outcome: context.outcome };
  }

  async flush(
    session: CanonicalRunExecutionSession,
    now: string,
  ): Promise<CanonicalExecutionBoundaryResult<number>> {
    const entries = await session.storage.getEntries();
    const pending = entries.filter(
      (entry): entry is Extract<ConversationTreeEntry, { type: "message" }> =>
        !session.materializedEntryIds.has(entry.id) && entry.type === "message",
    );
    const unsupported = entries.find(
      (entry) =>
        !session.materializedEntryIds.has(entry.id) && entry.type !== "message",
    );
    if (unsupported) {
      throw new Error(
        `Ephemeral harness entry '${unsupported.id}' (${unsupported.type}) requires an explicit canonical transition.`,
      );
    }
    if (pending.length === 0) return { kind: "ready", value: 0 };
    let committed = 0;
    for (let offset = 0; offset < pending.length; offset += 64) {
      const batch = pending.slice(offset, offset + 64);
      const drafts = batch.map((entry) =>
        projectHarnessCanonicalEntry({ entry, agentId: session.agentId }),
      );
      const commandId = materializationCommandId(session.runId, batch);
      const result = await this.timeline.append({
        conversationId: session.conversationId,
        runId: session.runId,
        commandId,
        now,
        actor: { kind: "worker", agentId: session.agentId },
        cause: { kind: "harness_messages_materialized" },
        entries: drafts,
      });
      if (result.kind === "rejected") return result;
      for (const entry of batch) session.materializedEntryIds.add(entry.id);
      committed += batch.length;
    }
    return { kind: "ready", value: committed };
  }

  async close(
    session: CanonicalRunExecutionSession,
    input: {
      state: "completed" | "failed" | "cancelled" | "abandoned" | "superseded";
      now: string;
      recoveryReason?: string;
    },
  ): Promise<CanonicalExecutionBoundaryResult<void>> {
    const flushed = await this.flush(session, input.now);
    if (flushed.kind === "rejected") return flushed;
    const result = await this.termination.close({
      conversationId: session.conversationId,
      runId: session.runId,
      agentId: session.agentId,
      now: input.now,
      state: input.state,
      recoveryReason: input.recoveryReason,
    });
    return result.kind === "rejected"
      ? result
      : { kind: "ready", value: undefined };
  }
}

function readySession(input: {
  conversationId: string;
  runId: string;
  agentId: string;
  conversationCreatedAt: string;
  snapshot: import("../../conversations/timeline/canonical-conversation-context.service.js").CanonicalContextSnapshot;
}): CanonicalExecutionBoundaryResult<CanonicalRunExecutionSession> {
  const storage = createCanonicalHarnessContext({
    snapshot: input.snapshot,
    createdAt: input.conversationCreatedAt,
  });
  return {
    kind: "ready",
    value: {
      conversationId: input.conversationId,
      runId: input.runId,
      agentId: input.agentId,
      storage,
      conversation: new Conversation(storage),
      materializedEntryIds: new Set(
        input.snapshot.entries.map((entry) => entry.entryId),
      ),
    },
  };
}

function materializationCommandId(
  runId: string,
  entries: readonly ConversationTreeEntry[],
): string {
  const digest = createHash("sha256")
    .update(
      canonicalConversationJson(
        entries.map((entry) => ({ id: entry.id, entry })),
      ),
    )
    .digest("hex")
    .slice(0, 32);
  return `materialize-harness:${runId}:${digest}`;
}

export async function appendExactHarnessMessage(
  session: CanonicalRunExecutionSession,
  message: AgentMessage,
  options?: { id?: string; timestamp?: string },
): Promise<string> {
  if (!options?.id) return session.conversation.appendMessage(message);
  await session.conversation.appendMessageWithId(
    options.id,
    message,
    options.timestamp,
  );
  return options.id;
}
