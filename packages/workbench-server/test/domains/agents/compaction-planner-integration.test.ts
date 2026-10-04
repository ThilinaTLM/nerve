import assert from "node:assert/strict";
import test from "node:test";
import { Conversation } from "@nervekit/harness/conversation";
import { convertToLlm } from "@nervekit/harness/messages";
import { deriveManualCompactionSettings } from "@nervekit/harness/compaction";
import { conversationMethodHandlers } from "../../../src/adapters/protocol/handlers/conversation-method-handlers.js";
import {
  withPromptCompactionAnchor,
  foregroundPromptAnchor,
} from "../../../src/domains/conversations/compaction-provenance.js";
import { CompactionStaleConflictError } from "../../../src/domains/conversations/compaction-owner.js";
import { fixture, barrier, summary } from "./compaction-test-fixture.js";

test("incident-shaped abandoned proposals become compactable, but an ineffective threshold preflight makes zero model calls", async (t) => {
  let calls = 0;
  let abandoned: string[] | undefined;
  const f = await fixture(t, async (input) => {
    calls++;
    abandoned = input.abandonedToolCallIds;
    return { text: summary, generatedBy: "model" };
  });
  const execution = await f.seed();
  await execution.appendMessage({
    role: "assistant",
    content: [
      {
        type: "toolCall",
        id: "provider_abandoned",
        name: "read_file",
        arguments: {},
      },
    ],
    stopReason: "toolUse",
    timestamp: 2,
  } as never);
  await execution.appendMessage({
    role: "user",
    content: "later real steering closes the old unanswered proposal",
    timestamp: 3,
  });
  for (let index = 0; index < 8; index++)
    await execution.appendMessage({
      role: "assistant",
      content: [
        { type: "thinking", thinking: "", thinkingSignature: "signed" },
      ],
      stopReason: "stop",
      timestamp: index + 4,
    } as never);
  await assert.rejects(
    f.service.compactConversation(
      "conv_scope",
      { keepRecentTokens: 1 },
      {
        reason: "threshold",
        thresholdTokens: 3000,
        contextWindow: 4000,
        summaryReserveTokens: 5000,
      },
    ),
    { code: "COMPACTION_PREFLIGHT_INEFFECTIVE" },
  );
  assert.equal(calls, 0);
  assert.equal(f.events.length, 0);
  const result = await f.service.compactConversation(
    "conv_scope",
    { keepRecentTokens: 1 },
    {
      reason: "threshold",
      thresholdTokens: 3000,
      contextWindow: 4000,
      summaryReserveTokens: 1000,
      pendingPromptTokens: 100,
    },
  );
  assert.equal(calls, 1);
  assert.ok(abandoned?.includes("provider_abandoned"));
  assert.ok(
    (result.entry.details as { tokensAfter: number }).tokensAfter < 3000,
  );
});

for (const agentId of ["agent_0", "agent_2"])
  test(`two owner compactions preserve ${agentId === "agent_0" ? "lead requirements" : "async assignment"} and steering verbatim`, async (t) => {
    const f = await fixture(t);
    const agent = f.agents.get(agentId)!;
    const execution = new Conversation(await f.storage.openAgentStorage(agent));
    const binding =
      "Deliver offline only. Never publish private source. Preserve the public API.";
    const anchor = await foregroundPromptAnchor(execution, agent);
    await withPromptCompactionAnchor(agent, anchor, async () => {
      await execution.appendMessage({
        role: "user",
        content: binding,
        timestamp: 0,
      });
      // Generated continuations within the same foreground run must not acquire provenance.
      await execution.appendMessage({
        role: "user",
        content: "synthetic continuation",
        timestamp: 1,
      });
    });
    for (let iteration = 0; iteration < 2; iteration++) {
      await execution.appendMessage({
        role: "user",
        content: "old working state ".repeat(6000),
        timestamp: 2,
      });
      await f.storage.appendAgentMessageWithId(
        agent,
        `entry_steering_${iteration}_${agentId}`,
        {
          role: "user",
          content: `Genuine steering ${iteration}: retain the tests.`,
          timestamp: 3,
        },
        undefined,
        { kind: "steering" },
      );
      if (iteration === 0)
        await f.storage.appendAgentMessageWithId(
          agent,
          `entry_plan_${agentId}`,
          {
            role: "user",
            content: "Accepted plan is the source of truth.",
            timestamp: 4,
          },
          undefined,
          { kind: "plan", text: "/tmp/approved-plan.md" },
        );
      await execution.appendMessage({
        role: "user",
        content: "recent tail",
        timestamp: 5,
      });
      const result = await f.service.compactConversation(
        "conv_scope",
        { keepRecentTokens: 1 },
        { agentId, contextWindow: 32000, summaryReserveTokens: 4000 },
      );
      const details = result.entry.details as {
        anchors: Array<{ kind: string; text: string }>;
        accounting: { anchorTokens: number };
      };
      assert.equal(
        details.anchors.find((item) => item.kind === anchor.kind)?.text,
        binding,
      );
      assert.ok(
        details.anchors.some(
          (item) =>
            item.text === `Genuine steering ${iteration}: retain the tests.`,
        ),
      );
      assert.ok(
        details.anchors.some(
          (item) =>
            item.kind === "plan" && item.text === "/tmp/approved-plan.md",
        ),
      );
      assert.ok(details.accounting.anchorTokens > 0);
      const visible = JSON.stringify(
        convertToLlm((await execution.buildContext()).messages),
      );
      assert.ok(visible.includes(binding));
      assert.ok(visible.includes("/tmp/approved-plan.md"));
      assert.equal(
        details.anchors.some((item) => item.text === "synthetic continuation"),
        false,
      );
    }
  });

test("protected pending approval defers manual compaction with pending_work and no summary", async (t) => {
  let calls = 0;
  const f = await fixture(t, async () => {
    calls++;
    return { text: summary, generatedBy: "model" };
  });
  const execution = await f.seed();
  await execution.appendMessage({
    role: "assistant",
    content: [
      {
        type: "toolCall",
        id: "provider_approval",
        name: "bash",
        arguments: {},
      },
    ],
    stopReason: "toolUse",
    timestamp: 2,
  } as never);
  await execution.appendMessage({
    role: "user",
    content: "a later boundary must not abandon protected approval work",
    timestamp: 3,
  });
  const timestamp = "2026-01-01T00:00:00.000Z";
  await f.journal.commit("conv_scope", {
    kind: "tool_call.revised",
    events: [
      {
        kind: "tool_call.upserted",
        conversationId: "conv_scope",
        toolCall: {
          id: "tool_approval",
          agentId: "agent_0",
          conversationId: "conv_scope",
          projectId: "proj_scope",
          toolName: "bash",
          providerToolCallId: "provider_approval",
          risk: "command",
          args: {},
          cwd: "/tmp",
          status: "waiting",
          revision: 1,
          attempt: 1,
          interactions: [
            {
              kind: "approval",
              ordinal: 0,
              status: "pending",
              requestedAt: timestamp,
              updatedAt: timestamp,
              request: {
                risk: "command",
                reason: "Requires approval",
                offeredScopes: ["single_call"],
              },
            },
          ],
          createdAt: timestamp,
          updatedAt: timestamp,
        } as never,
      },
    ],
  });
  await assert.rejects(
    f.service.compactConversation("conv_scope", { keepRecentTokens: 1 }),
    { code: "COMPACTION_PENDING_WORK" },
  );
  assert.equal(calls, 0);
  assert.equal(
    (f.events.at(-1)?.data as { code: string }).code,
    "pending_work",
  );
});

test("manual model-window defaults remain enabled with auto switched off", async (t) => {
  let reserve = 0;
  const f = await fixture(t, async (input) => {
    reserve = input.summaryReserveTokens;
    return { text: summary, generatedBy: "model" };
  });
  await f.seed();
  const result = await f.service.compactConversation("conv_scope");
  const defaults = deriveManualCompactionSettings(100000, {
    auto: false,
    profile: "balanced",
    customTriggerPercent: 80,
    customKeepRecentPercent: 15,
  });
  assert.equal(reserve, defaults.reserveTokens);
  assert.equal(
    (result.entry.details as { policy: { keepRecentTokens: number } }).policy
      .keepRecentTokens,
    defaults.keepRecentTokens,
  );
});

test("RPC targets child owners and resolves a lead-agent notice cancellation to the shared lead scope", async (t) => {
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const f = await fixture(t, async (input) => {
    if (input.agentId === "agent_3")
      return { text: summary, generatedBy: "model" };
    entered();
    await new Promise<void>((_resolve, reject) =>
      input.signal!.addEventListener(
        "abort",
        () => reject(input.signal!.reason),
        { once: true },
      ),
    );
    return undefined;
  });
  await f.seed();
  await f.seed("agent_3");
  const state = { compactionService: f.service } as never;
  const child = await conversationMethodHandlers["conversation.compact"](
    state,
    { conversationId: "conv_scope", agentId: "agent_3", keepRecentTokens: 1 },
  );
  assert.equal(
    (await f.journal.load("conv_scope")).agentModelLeafIds.get("agent_3"),
    child.entry.id,
  );
  const pending = conversationMethodHandlers["conversation.compact"](state, {
    conversationId: "conv_scope",
    agentId: "agent_0",
    keepRecentTokens: 1,
  });
  const rejected = assert.rejects(pending, { code: "COMPACTION_CANCELLED" });
  await started;
  await conversationMethodHandlers["conversation.compaction.cancel"](state, {
    conversationId: "conv_scope",
    agentId: "agent_1",
  });
  await rejected;
  await assert.rejects(f.service.cancelCompaction("conv_other", "agent_1"), {
    code: "INVALID_COMPACTION_OWNER",
  });
});

test("manual no-new-history and stale summaries publish typed failed codes", async (t) => {
  const f = await fixture(t);
  await f.storage.appendAgentMessageWithId(
    f.agents.get("agent_0")!,
    "entry_only",
    { role: "user", content: "small", timestamp: 0 },
  );
  await assert.rejects(f.service.compactConversation("conv_scope"), {
    code: "NOTHING_TO_COMPACT",
  });
  assert.equal(
    (f.events.at(-1)?.data as { code: string }).code,
    "no_new_history",
  );
  await f.storage.appendAgentMessageWithId(
    f.agents.get("agent_0")!,
    "entry_second",
    { role: "user", content: "another small turn", timestamp: 1 },
  );
  await assert.rejects(
    f.service.compactConversation("conv_scope", { keepRecentTokens: 1 }),
    { code: "INEFFECTIVE_COMPACTION" },
  );
  assert.equal((f.events.at(-1)?.data as { code: string }).code, "ineffective");
  const gate = barrier();
  const stale = await fixture(t, gate.summarize);
  await stale.seed();
  const pending = stale.service.compactConversation("conv_scope", {
    keepRecentTokens: 1,
  });
  await gate.entered;
  await stale.storage.appendAgentMessageWithId(
    stale.agents.get("agent_0")!,
    "entry_new",
    { role: "user", content: "new", timestamp: 1 },
  );
  gate.release();
  await assert.rejects(pending, CompactionStaleConflictError);
  assert.equal((stale.events.at(-1)?.data as { code: string }).code, "stale");
});

test("queued genuine steering is tagged by ID while automatic continuations remain unmarked", async (t) => {
  const f = await fixture(t);
  const execution = await f.seed();
  f.storage.registerQueuedPromptAnchor(execution, "entry_genuine_steer", {
    kind: "steering",
  });
  await execution.appendMessage({
    role: "user",
    content: "automatic compaction continuation",
    timestamp: 2,
  });
  const synthetic = await execution.getLeafId();
  await execution.appendMessageWithId("entry_genuine_steer", {
    role: "user",
    content: "preserve my newest constraint",
    timestamp: 3,
  });
  assert.equal(
    (await execution.getEntry(synthetic!))?.compactionAnchor,
    undefined,
  );
  assert.deepEqual(
    (await execution.getEntry("entry_genuine_steer"))?.compactionAnchor,
    { kind: "steering" },
  );
});

test("overflowing initiating anchors are passed to the summarizer and persisted without truncating them", async (t) => {
  let overflow: Array<{ sourceEntryId: string }> | undefined;
  const f = await fixture(t, async (input) => {
    overflow = input.anchorOverflow;
    return { text: summary, generatedBy: "model" };
  });
  const agent = f.agents.get("agent_0")!;
  await f.storage.appendAgentMessageWithId(
    agent,
    "entry_oversized_request",
    {
      role: "user",
      content: "Binding requirements ".repeat(8000),
      timestamp: 0,
    },
    undefined,
    { kind: "request" },
  );
  await f.storage.appendAgentMessageWithId(agent, "entry_tail", {
    role: "user",
    content: "continue",
    timestamp: 1,
  });
  const result = await f.service.compactConversation(
    "conv_scope",
    { keepRecentTokens: 1 },
    { contextWindow: 8000, summaryReserveTokens: 1000 },
  );
  assert.deepEqual(overflow, [
    { sourceEntryId: "entry_oversized_request", kind: "request" },
  ]);
  assert.deepEqual(
    (result.entry.details as { anchorOverflow: unknown }).anchorOverflow,
    overflow,
  );
});
