import { join } from "node:path";
import { CanonicalStore } from "../../../src/infrastructure/persistence/canonical-sqlite/index.js";
import { AgentRepository } from "../../../src/domains/agents/agent.repository.js";
import type { InitializedStorage } from "../../../src/infrastructure/storage-bootstrap/index.js";
import assert from "node:assert/strict";
import { Conversation } from "@nervekit/harness/conversation";
import test from "node:test";
import type { AgentRecord } from "@nervekit/contracts/agents";
import { ConversationRepository } from "../../../src/domains/conversations/conversation.repository.js";
import { WorkbenchRunService } from "../../../src/domains/runs/application/workbench-run.service.js";
import { installIterationCompaction } from "../../../src/domains/agents/execution/iteration-compaction.js";
import {
  CompactionStaleConflictError,
  resolveCompactionOwner,
} from "../../../src/domains/conversations/compaction-owner.js";
import { fixture, barrier, summary } from "./compaction-test-fixture.js";

test("owner append during a barrier summary fails CAS without a checkpoint", async (t) => {
  const gate = barrier();
  const f = await fixture(t, gate.summarize);
  await f.seed();
  const pending = f.service.compactConversation("conv_scope", {
    keepRecentTokens: 1,
  });
  await gate.entered;
  await f.storage.appendAgentMessageWithId(
    f.agents.get("agent_1")!,
    "entry_concurrent",
    { role: "user", content: "new steering", timestamp: 2 },
  );
  gate.release();
  await assert.rejects(pending, CompactionStaleConflictError);
  const state = await f.journal.load("conv_scope");
  assert.equal(state.modelLeafId, "entry_concurrent");
  assert.equal(
    state.modelEntries.some((entry) => entry.type === "compaction"),
    false,
  );
});

test("unrelated explore commits do not stale lead summaries or advance lead metadata", async (t) => {
  const gate = barrier();
  let calls = 0;
  const f = await fixture(t, async (input) =>
    ++calls === 1
      ? gate.summarize(input)
      : { text: summary, generatedBy: "model" },
  );
  await f.seed();
  await f.seed("agent_3");
  const pending = f.service.compactConversation("conv_scope", {
    keepRecentTokens: 1,
  });
  await gate.entered;
  await assert.rejects(
    f.service.compactConversation("conv_scope", {}, { agentId: "agent_1" }),
    { code: "COMPACTION_IN_PROGRESS" },
  );
  assert.equal(
    await f.service.cancelCompaction("conv_scope", "agent_3"),
    false,
  );
  const child = await f.service.compactConversation(
    "conv_scope",
    { keepRecentTokens: 1 },
    { agentId: "agent_3" },
  );
  assert.equal(f.getConversation().activeEntryId, undefined);
  assert.equal(
    (await f.journal.load("conv_scope")).modelLeafId,
    "entry_recent_agent_0",
  );
  gate.release();
  const lead = await pending;
  const state = await f.journal.load("conv_scope");
  assert.equal(state.agentModelLeafIds.get("agent_3"), child.entry.id);
  assert.equal(state.modelLeafId, lead.entry.id);
  assert.equal(
    (
      await (
        await f.storage.openAgentStorage(f.agents.get("agent_3")!)
      ).getEntry(child.entry.id)
    )?.parentId,
    "entry_recent_agent_3",
  );
});

test("manual rejects nonterminal owner runs before model work", async (t) => {
  let calls = 0;
  const f = await fixture(t, async () => {
    calls++;
    return { text: summary, generatedBy: "model" };
  });
  await f.seed();
  f.setBusy(true);
  await assert.rejects(f.service.compactConversation("conv_scope"), {
    code: "COMPACTION_OWNER_BUSY",
  });
  assert.equal(calls, 0);
});

test("run admission without append is not mutual exclusion; existing wrappers read the committed checkpoint", async (t) => {
  const gate = barrier();
  const f = await fixture(t, gate.summarize);
  const execution = await f.seed();
  const pending = f.service.compactConversation("conv_scope", {
    keepRecentTokens: 1,
  });
  await gate.entered;
  f.setBusy(true);
  gate.release();
  const result = await pending;
  assert.equal(await execution.getLeafId(), result.entry.id);
  assert.equal(
    (await execution.getContextBranch()).some(
      (entry) => entry.type === "compaction",
    ),
    true,
  );
  const id = await execution.appendMessage({
    role: "user",
    content: "admitted execution",
    timestamp: 2,
  });
  assert.equal((await execution.getEntry(id))?.parentId, result.entry.id);
});

test("overflow summarizes the failed assistant parent and never navigates the tip on failure", async (t) => {
  const gate = barrier();
  const f = await fixture(t, gate.summarize);
  const execution = await f.seed("agent_2");
  const failed = await execution.appendMessage({
    role: "assistant",
    content: [],
    api: "openai-completions",
    provider: "openai",
    model: "test",
    stopReason: "error",
    errorMessage: "context overflow",
    timestamp: 2,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  });
  const pending = f.service.compactConversation(
    "conv_scope",
    { keepRecentTokens: 1 },
    { reason: "overflow", agentId: "agent_2", failedEntryId: failed },
  );
  await gate.entered;
  assert.equal(await execution.getLeafId(), failed);
  gate.release();
  const result = await pending;
  assert.equal(
    (await execution.getEntry(result.entry.id))?.parentId,
    "entry_recent_agent_2",
  );
  assert.equal(
    (await execution.getContextBranch()).some((entry) => entry.id === failed),
    false,
  );
  assert.equal((await f.journal.load("conv_scope")).modelLeafId, null);
});

test("all lead agents resolve to one scope and explore owns its tree", () => {
  assert.equal(
    resolveCompactionOwner("conv_scope", {
      id: "agent_a",
      conversationId: "conv_scope",
      executionKind: "root",
    } as AgentRecord).key,
    resolveCompactionOwner("conv_scope", {
      id: "agent_b",
      conversationId: "conv_scope",
    } as AgentRecord).key,
  );
  assert.equal(
    resolveCompactionOwner("conv_scope", {
      id: "agent_child",
      conversationId: "conv_scope",
      executionKind: "explore",
      parentAgentId: "agent_a",
    } as AgentRecord).ownerAgentId,
    "agent_child",
  );
});

test("partial tool batches cannot insert a checkpoint between proposal and results", async (t) => {
  const f = await fixture(t);
  const execution = await f.seed("agent_3");
  const proposal = await execution.appendMessage({
    role: "assistant",
    content: [
      { type: "toolCall", id: "provider_a", name: "read_file", arguments: {} },
      { type: "toolCall", id: "provider_b", name: "read_file", arguments: {} },
    ],
    timestamp: 2,
  } as never);
  const first = await execution.appendMessage({
    role: "toolResult",
    toolCallId: "provider_a",
    toolName: "read_file",
    content: [{ type: "text", text: "first" }],
    isError: false,
    timestamp: 3,
  });
  let hook!: (event: {
    hasMoreToolCalls: boolean;
    message: { content: unknown[] };
  }) => Promise<unknown>;
  let calls = 0;
  installIterationCompaction(
    {
      on: (_name: unknown, callback: typeof hook) => {
        hook = callback;
      },
    } as never,
    async () => {
      calls++;
      await f.service.compactConversation(
        "conv_scope",
        { keepRecentTokens: 1 },
        { reason: "threshold", agentId: "agent_3" },
      );
      return { status: "compacted", reason: "checkpoint_committed" };
    },
    () => "continue",
  );
  await hook({ hasMoreToolCalls: true, message: { content: [] } });
  assert.equal(calls, 0);
  assert.equal(await execution.getLeafId(), first);
  const second = await execution.appendMessage({
    role: "toolResult",
    toolCallId: "provider_b",
    toolName: "read_file",
    content: [{ type: "text", text: "second" }],
    isError: false,
    timestamp: 4,
  });
  assert.equal((await execution.getEntry(first))?.parentId, proposal);
  assert.equal((await execution.getEntry(second))?.parentId, first);
  await execution.appendMessage({
    role: "user",
    content: "batch finished",
    timestamp: 5,
  });
  await hook({ hasMoreToolCalls: false, message: { content: [] } });
  assert.equal(calls, 1);
  const path = await (
    await f.storage.openAgentStorage(f.agents.get("agent_3")!)
  ).getPathToRoot(await execution.getLeafId());
  assert.equal(path.at(-1)?.type, "compaction");
  assert.equal(path.find((entry) => entry.id === second)?.parentId, first);
});

test("lead visible-tip navigation stales a summary even when the model tip did not move", async (t) => {
  const gate = barrier();
  const f = await fixture(t, gate.summarize);
  await f.seed();
  const pending = f.service.compactConversation("conv_scope", {
    keepRecentTokens: 1,
  });
  await gate.entered;
  await f.journal.commit("conv_scope", {
    kind: "conversation.upserted",
    events: [
      {
        kind: "conversation.upserted",
        conversationId: "conv_scope",
        conversation: {
          ...f.getConversation(),
          activeEntryId: "entry_navigation",
        },
      },
    ],
  });
  gate.release();
  await assert.rejects(pending, CompactionStaleConflictError);
  assert.equal(
    (await f.journal.load("conv_scope")).modelLeafId,
    "entry_recent_agent_0",
  );
});

test("guarded lead commit merges current metadata rather than replacing unrelated changes", async (t) => {
  const gate = barrier();
  const f = await fixture(t, gate.summarize);
  await f.seed();
  const pending = f.service.compactConversation("conv_scope", {
    keepRecentTokens: 1,
  });
  await gate.entered;
  await new ConversationRepository(f.journal).write({
    ...f.getConversation(),
    title: "Changed during summary",
  });
  gate.release();
  await pending;
  assert.equal(f.getConversation().title, "Changed during summary");
});

test("failed overflow generation preserves the exact failed owner tip", async (t) => {
  const f = await fixture(t, async () => undefined);
  const execution = await f.seed("agent_3");
  const failed = await execution.appendMessage({
    role: "assistant",
    content: [],
    stopReason: "error",
    timestamp: 2,
  } as never);
  await assert.rejects(
    f.service.compactConversation(
      "conv_scope",
      { keepRecentTokens: 1 },
      { reason: "overflow", agentId: "agent_3", failedEntryId: failed },
    ),
    { code: "COMPACTION_FAILED" },
  );
  assert.equal(await execution.getLeafId(), failed);
  assert.equal(
    (await f.journal.load("conv_scope")).agentModelEntries
      .get("agent_3")
      ?.some((entry) => entry.type === "compaction"),
    false,
  );
});

test("stable handoff model IDs can be reused after a model-only append without duplicating ancestry", async (t) => {
  const f = await fixture(t);
  await f.seed();
  const agent = f.agents.get("agent_0")!;
  const message = {
    role: "user",
    content: "accepted plan follow-up",
    timestamp: 2,
  } as const;
  const first = await f.storage.appendAgentMessageWithId(
    agent,
    "entry_stable",
    message,
  );
  const retry = await f.storage.appendAgentMessageWithId(
    agent,
    "entry_stable",
    { ...message, timestamp: 3 },
  );
  assert.deepEqual(retry, first);
  assert.equal(
    (await f.journal.load("conv_scope")).modelEntries.filter(
      (entry) => entry.id === "entry_stable",
    ).length,
    1,
  );
});

test("canonical active lookup isolates persisted additional-root and child owners", async () => {
  const agents = new Map(
    ["root", "root", "explore"].map((kind, index) => [
      `agent_${index}`,
      {
        id: `agent_${index}`,
        conversationId: "conv_scope",
        executionKind: kind,
        contextOwnerAgentId: index === 0 ? null : `agent_${index}`,
        parentAgentId: index === 2 ? "agent_0" : undefined,
      },
    ]),
  );
  const queried: string[] = [];
  const service = {
    state: { agents },
    scopeId: (agent: { id: string }) => `conv_scope:${agent.id}`,
    unitOfWork: {
      findActive: async (scope: string) => {
        queried.push(scope);
        return scope.endsWith("agent_1")
          ? { run: { status: "interrupted" } }
          : undefined;
      },
    },
  };
  assert.equal(
    await WorkbenchRunService.prototype.hasNonterminalOwnerRun.call(
      service as never,
      "conv_scope",
    ),
    false,
  );
  assert.deepEqual(queried, ["conv_scope:agent_0"]);
  queried.length = 0;
  assert.equal(
    await WorkbenchRunService.prototype.hasNonterminalOwnerRun.call(
      service as never,
      "conv_scope",
      "agent_1",
    ),
    true,
  );
  assert.deepEqual(queried, ["conv_scope:agent_1"]);
  queried.length = 0;
  assert.equal(
    await WorkbenchRunService.prototype.hasNonterminalOwnerRun.call(
      service as never,
      "conv_scope",
      "agent_2",
    ),
    false,
  );
  assert.deepEqual(queried, ["conv_scope:agent_2"]);
});

test("protected query returns original pending provider IDs only for the requested model owner", async (t) => {
  const f = await fixture(t);
  const timestamp = "2026-01-01T00:00:00.000Z";
  await f.journal.commit("conv_scope", {
    kind: "tool_call.revised",
    events: [0, 1, 2].map((index) => ({
      kind: "tool_call.upserted" as const,
      conversationId: "conv_scope",
      toolCall: {
        id: `tool_${index}`,
        agentId: index === 0 ? "agent_1" : "agent_3",
        conversationId: "conv_scope",
        projectId: "proj_scope",
        toolName: "bash",
        providerToolCallId: `original_provider|${index}`,
        sourceToolCallId: `normalized_${index}`,
        risk: "command",
        args: {},
        cwd: "/tmp",
        status: index === 2 ? "completed" : "running",
        ...(index === 2 ? { settledAt: timestamp } : {}),
        revision: 1,
        attempt: 1,
        interactions: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      } as never,
    })),
  });
  assert.deepEqual(
    await f.storage.pendingProviderToolCallIds(
      "conv_scope",
      undefined,
      (id) => f.agents.get(id)!,
    ),
    ["original_provider|0"],
  );
  assert.deepEqual(
    await f.storage.pendingProviderToolCallIds(
      "conv_scope",
      "agent_3",
      (id) => f.agents.get(id)!,
    ),
    ["original_provider|1"],
  );
});

test("explicit context bindings isolate additional roots and preserve an already copied historical prefix", async (t) => {
  const f = await fixture(t);
  await f.seed("agent_0");
  const store = new CanonicalStore(join(f.home, "data", "nerve.sqlite"), {
    readerCount: 0,
  });
  await store.initialize();
  t.after(() => store.close());
  for (const [index, id] of ["agent_0", "agent_1"].entries()) {
    await store.writeDocument({
      namespace: "agent",
      scopeId: "global",
      documentId: id,
      expectedRevision: 0,
      now: "2026-01-01T00:00:00.000Z",
      data: {
        ...f.agents.get(id),
        projectId: "proj_scope",
        projectDir: "/source",
        rootAgentId: id,
        mode: "coding",
        permissionLevel: "supervised",
        workspaceScope: { roots: ["/source"] },
        budget: { depth: 0, maxDepth: 3 },
        thinkingLevel: "off",
        createdAt: `2026-01-0${index + 1}T00:00:00.000Z`,
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });
  }
  const historical = await f.journal.load("conv_scope");
  const migrated = await new AgentRepository({
    canonicalStore: store,
  } as InitializedStorage).loadAll();
  for (const agent of migrated) f.agents.set(agent.id, agent);
  assert.equal(f.agents.get("agent_0")!.contextOwnerAgentId, null);
  assert.equal(f.agents.get("agent_1")!.contextOwnerAgentId, "agent_1");
  for (const id of ["agent_2", "agent_3"])
    f.agents.set(id, { ...f.agents.get(id)!, contextOwnerAgentId: id });
  // This fixture migrates through a separate store, unlike runtime startup's
  // shared store/cache invalidation. Refresh its old journal before writing.
  await f.journal.loadFresh("conv_scope");
  const secondary = await f.storage.openAgentStorage(f.agents.get("agent_1")!);
  assert.deepEqual(
    (await secondary.getEntries()).map((entry) => entry.id),
    historical.modelEntries.map((entry) => entry.id),
  );
  const secondaryConversation = new Conversation(secondary);
  await secondaryConversation.appendMessage({
    role: "user",
    content: "Secondary private follow-up",
    timestamp: 5,
  });
  const copiedWithFollowUp = await secondary.getEntries();
  await new AgentRepository({
    canonicalStore: store,
  } as InitializedStorage).loadAll();
  await f.journal.loadFresh("conv_scope");
  assert.deepEqual(
    await secondary.getEntries(),
    copiedWithFollowUp,
    "reloading migrated bindings must not duplicate or reset an owned prefix",
  );
  await f.seed("agent_2");
  await f.seed("agent_3");
  const texts = await Promise.all(
    ["agent_0", "agent_1", "agent_2", "agent_3"].map(async (id) =>
      JSON.stringify(
        await (
          await f.storage.openAgentStorage(f.agents.get(id)!)
        ).getEntries(),
      ),
    ),
  );
  assert.doesNotMatch(
    texts[0]!,
    /Secondary private follow-up|entry_recent_agent_[23]/,
  );
  assert.match(texts[1]!, /Secondary private follow-up/);
  assert.doesNotMatch(texts[1]!, /entry_recent_agent_[23]/);
  assert.doesNotMatch(
    texts[2]!,
    /Secondary private follow-up|entry_recent_agent_[03]/,
  );
  assert.doesNotMatch(
    texts[3]!,
    /Secondary private follow-up|entry_recent_agent_[02]/,
  );
  const orphan = { ...f.agents.get("agent_3")!, parentAgentId: undefined };
  assert.equal(
    resolveCompactionOwner("conv_scope", orphan).ownerAgentId,
    orphan.id,
  );
});
