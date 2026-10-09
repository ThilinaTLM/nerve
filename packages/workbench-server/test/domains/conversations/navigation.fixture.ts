import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { agentRecordSchema } from "@nervekit/contracts/agents";
import type {
  ConversationEntry,
  ConversationRecord,
} from "@nervekit/contracts/conversations";
import type { ConversationTreeEntry } from "@nervekit/harness/conversation";
import { CanonicalStore } from "../../../src/infrastructure/persistence/canonical-sqlite/index.js";
import { ConversationJournalRepository } from "../../../src/domains/conversations/conversation-journal.repository.js";
import {
  JournalBackedNavigation,
  resolveConversationNavigationAgent,
} from "../../../src/domains/conversations/journal-backed-navigation.js";
import { KeyedSerialLock } from "../../../src/domains/runs/runtime/run-locks.js";
import { NavigationService } from "../../../src/domains/conversations/operations/navigation-service.js";
import { serializeState } from "../../../src/domains/conversations/conversation-state-materializer.js";
import { validatePublicEvent } from "@nervekit/contracts/events";

export const timestamp = "2026-07-26T00:00:00.000Z";
export function modelEntry(
  id: string,
  parentId: string | null = null,
): ConversationTreeEntry {
  return {
    type: "message",
    id,
    parentId,
    timestamp,
    message: { role: "user", content: id, timestamp: Date.parse(timestamp) },
  };
}
export async function navigationFixture(
  t: TestContext,
  options: { empty?: boolean } = {},
) {
  const home = await mkdtemp(join(tmpdir(), "nerve-model-navigation-"));
  const canonical = new CanonicalStore(join(home, "canonical.sqlite"));
  await canonical.initialize();
  const journal = new ConversationJournalRepository({
    paths: { home },
    canonicalStore: canonical,
  });
  t.after(async () => {
    await journal.close();
    await canonical.close();
    await rm(home, { recursive: true, force: true });
  });
  let projected: ConversationRecord = {
    id: "conv_navigation",
    projectId: "proj_navigation",
    title: "Navigation",
    mode: "coding",
    permissionLevel: "supervised",
    createdAt: timestamp,
    updatedAt: timestamp,
    activeEntryId: options.empty ? undefined : "entry_old",
  };
  const agent = agentRecordSchema.parse({
    id: "agent_lead",
    contextOwnerAgentId: null,
    conversationId: projected.id,
    projectId: projected.projectId,
    projectDir: home,
    rootAgentId: "agent_lead",
    mode: "coding",
    permissionLevel: "supervised",
    workspaceScope: { roots: [home] },
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  const agents = new Map(options.empty ? [] : [[agent.id, agent]]);
  const enumerationForbidden = (): never => {
    throw new Error("Navigation must not enumerate the actor registry");
  };
  agents.values = enumerationForbidden;
  agents.keys = enumerationForbidden;
  agents.entries = enumerationForbidden;
  agents.forEach = enumerationForbidden;
  agents[Symbol.iterator] = enumerationForbidden;
  if (!options.empty) {
    await canonical.writeDocument({
      namespace: "agent",
      scopeId: "global",
      documentId: agent.id,
      data: agent,
    });
    await canonical.writeDocument({
      namespace: "agent-context-binding",
      scopeId: "global",
      documentId: projected.id,
      data: { legacyRootAgentId: agent.id },
    });
  }
  const transcript = (
    id: string,
    parentEntryId?: string,
  ): ConversationEntry => ({
    id,
    conversationId: projected.id,
    role: "user",
    kind: "message",
    text: id,
    parentEntryId,
    createdAt: timestamp,
  });
  await journal.commit(projected.id, {
    kind: "fixture.seed",
    events: [
      {
        kind: "conversation.upserted",
        conversationId: projected.id,
        conversation: projected,
      },
      ...(!options.empty
        ? [
            {
              kind: "conversation.entry_appended" as const,
              conversationId: projected.id,
              entry: transcript("entry_target"),
            },
            {
              kind: "conversation.entry_appended" as const,
              conversationId: projected.id,
              entry: transcript("entry_old", "entry_target"),
            },
            {
              kind: "model_context.entry_appended" as const,
              conversationId: projected.id,
              entry: modelEntry("entry_target") as never,
            },
            {
              kind: "model_context.entry_appended" as const,
              conversationId: projected.id,
              entry: modelEntry("entry_old", "entry_target") as never,
            },
          ]
        : []),
    ],
  });
  const events: Array<{ type: string; data: Record<string, unknown> }> = [];
  const failures: unknown[] = [];
  const lock = new KeyedSerialLock();
  let activeStatus: "running" | "interrupted" | undefined;
  const rebuildTargets: string[] = [];
  let rebuild = async (
    _conversationId: string,
    agentId: string,
  ): Promise<void> => {
    const bound = agents.get(agentId);
    if (!bound || bound.contextOwnerAgentId !== null)
      throw new Error(
        "Committed navigation control agent is unavailable for derived context rebuild.",
      );
    rebuildTargets.push(agentId);
  };
  let publishFailure = false;
  let reporterFailure = false;
  let projectedEntries: ConversationEntry[] = [];
  let admissionHeld = false;
  let projectionWhileFenced = false;
  const adapter = new JournalBackedNavigation(
    journal,
    (conversation) =>
      resolveConversationNavigationAgent(canonical, conversation, (id) =>
        agents.get(id),
      ),
    (conversation, entries) => {
      projected = conversation;
      projectedEntries = entries;
      projectionWhileFenced = admissionHeld;
    },
  );
  const service = new NavigationService({
    navigation: adapter,
    withAdmission: (id, action) =>
      lock.exclusive(id, async () => {
        admissionHeld = true;
        try {
          return await action();
        } finally {
          admissionHeld = false;
        }
      }),
    getActiveRunStatus: async () => activeStatus,
    rebuildConversation: (conversationId, agentId) =>
      rebuild(conversationId, agentId),
    reportDerivedFailure: (error) => {
      failures.push(error);
      if (reporterFailure) throw new Error("diagnostic observer unavailable");
    },
    events: {
      publish: async (type: string, data: Record<string, unknown>) => {
        if (publishFailure) throw new Error("notification unavailable");
        validatePublicEvent(type, data, "workbench_server");
        events.push({ type, data });
      },
    } as never,
  });
  return {
    home,
    canonical,
    journal,
    adapter,
    service,
    agent,
    agents,
    events,
    failures,
    rebuildTargets,
    lock,
    conversationId: projected.id,
    projection: () => ({
      conversation: projected,
      entries: projectedEntries,
      fenced: projectionWhileFenced,
    }),
    activeStatus: (value: typeof activeStatus) => {
      activeStatus = value;
    },
    rebuild: (
      action: (conversationId: string, agentId: string) => Promise<void>,
    ) => {
      rebuild = action;
    },
    failNotifications: () => {
      publishFailure = true;
    },
    failFailureReporter: () => {
      reporterFailure = true;
    },
    seedLegacyLeaf: async (leafId: string) => {
      await journal.checkpointLoaded();
      const state = serializeState(await journal.load(projected.id));
      state.modelLeafId = leafId;
      state.conversation = { ...state.conversation!, activeEntryId: leafId };
      await canonical.checkpointConversationState(state);
      await journal.loadFresh(projected.id);
    },
  };
}
