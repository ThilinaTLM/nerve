import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { Conversation } from "@nervekit/harness/conversation";
import type { AgentRecord } from "@nervekit/contracts/agents";
import type {
  ConversationEntry,
  ConversationRecord,
} from "@nervekit/contracts/conversations";
import { ConversationJournalRepository } from "../../../src/domains/conversations/conversation-journal.repository.js";
import { ConversationRepository } from "../../../src/domains/conversations/conversation.repository.js";
import { EntryRepository } from "../../../src/domains/conversations/entry.repository.js";
import { ConversationHarnessStorage } from "../../../src/domains/conversations/conversation-harness-storage.js";
import {
  CompactionService,
  type CompactionSummarizer,
} from "../../../src/domains/conversations/operations/compaction-service.js";

export const summary = `## Goal
Finish the assignment.
## Requirements and Constraints
- Preserve behavior.
## Work Completed
- [x] Inspected code.
## Work Remaining
- [ ] Validate changes.
## Key Decisions
- Keep existing APIs.
## Current Working State
- Changes need testing.
## Continuation Plan
1. Test changes.
## Critical References
- src/feature.ts`;
export function barrier() {
  let release!: () => void;
  let started!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const summarize: CompactionSummarizer = async () => {
    started();
    await wait;
    return { text: summary, generatedBy: "model" };
  };
  return { release, entered, summarize };
}
export async function fixture(
  t: TestContext,
  summarize?: CompactionSummarizer,
) {
  const home = await mkdtemp(join(tmpdir(), "nerve-compaction-owner-"));
  const journal = new ConversationJournalRepository({ paths: { home } });
  t.after(async () => {
    await journal.close();
    await rm(home, { recursive: true, force: true });
  });
  const record: ConversationRecord = {
    id: "conv_scope",
    projectId: "proj_scope",
    title: "Scope",
    mode: "coding",
    permissionLevel: "supervised",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const agents = new Map(
    ["root", "root2", "async_developer", "explore"].map((kind, index) => {
      const agent = {
        id: `agent_${index}`,
        conversationId: record.id,
        executionKind: kind === "root2" ? "root" : kind,
      } as AgentRecord;
      return [agent.id, agent] as const;
    }),
  );
  await new ConversationRepository(journal).write(record);
  const resident = await journal.load(record.id);
  const getConversation = () => resident.conversation!;
  const storage = new ConversationHarnessStorage(
    new ConversationRepository(journal),
    getConversation,
  );
  const entries = new EntryRepository(journal);
  let busy = false;
  const events: Array<{ type: string; data: unknown }> = [];
  const service = new CompactionService(
    getConversation,
    () => ({ id: "proj_scope" }) as never,
    async () => {
      throw new Error("unguarded append forbidden");
    },
    storage,
    async () => {},
    {
      publish: async (type: string, data: unknown) => {
        events.push({ type, data });
      },
    } as never,
    summarize ?? (async () => ({ text: summary, generatedBy: "model" })),
    {},
    async (input, modelEntry, guard) => {
      const entry = input as ConversationEntry;
      await entries.appendCompaction({ entry, modelEntry, guard });
      return entry;
    },
    (id) => agents.get(id)!,
    async () => busy,
    async () => ({
      contextWindow: 100_000,
      settings: {
        auto: false,
        profile: "balanced",
        customTriggerPercent: 80,
        customKeepRecentPercent: 15,
      },
    }),
  );
  async function seed(agentId = "agent_0") {
    const agent = agents.get(agentId)!;
    await storage.appendAgentMessageWithId(agent, `entry_old_${agentId}`, {
      role: "user",
      content: "requirements ".repeat(6000),
      timestamp: 0,
    });
    await storage.appendAgentMessageWithId(agent, `entry_recent_${agentId}`, {
      role: "user",
      content: "continue",
      timestamp: 1,
    });
    return new Conversation(await storage.openAgentStorage(agent));
  }
  return {
    events,
    journal,
    storage,
    service,
    agents,
    seed,
    setBusy: (value: boolean) => {
      busy = value;
    },
    getConversation,
  };
}
