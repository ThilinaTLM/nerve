import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Message } from "@earendil-works/pi-ai";
import {
  planCompaction,
  assessCompactionUsefulness,
  assertSafeCompactionBoundary,
} from "../../src/compaction/cut-points.js";
import { prepareCompaction } from "../../src/compaction/compaction.js";
import { estimatePostCompactionContext } from "../../src/compaction/checkpoint-accounting.js";
import { deriveManualCompactionSettings } from "../../src/compaction/policy.js";
import { serializeConversation } from "../../src/compaction/serialization.js";
import { buildConversationContext } from "../../src/conversation/context.js";
import { convertToLlm } from "../../src/messages/messages.js";
import type { ConversationTreeEntry } from "../../src/conversation/entries.js";
import {
  assistant,
  entry,
  user,
  checkpoint,
  timestamp,
} from "./compaction-fixtures.js";

function call(
  id: string,
  ids = [id],
  stopReason: "stop" | "error" | "aborted" = "stop",
) {
  const message = assistant(20);
  message.stopReason = stopReason;
  message.content = ids.map((id) => ({
    type: "toolCall",
    id,
    name: "read",
    arguments: { path: "/tmp/source.ts" },
  }));
  return entry(id, message);
}
function result(id: string, isError = false, text = "evidence") {
  return entry(`result_${id}`, {
    role: "toolResult",
    toolCallId: id,
    toolName: "read",
    content: [{ type: "text", text }],
    isError,
    timestamp: 0,
  });
}
function anchor(
  id: string,
  text: string,
  kind: "request" | "assignment" | "steering" | "plan",
) {
  return { ...entry(id, user(text)), compactionAnchor: { kind } };
}
function persist(
  id: string,
  entries: ConversationTreeEntry[],
  plan: ReturnType<typeof planCompaction>,
) {
  return {
    ...checkpoint(
      id,
      entries[plan.firstKeptEntryIndex].id,
      "lossy working state",
    ),
    details: {
      anchors: plan.anchors,
      anchorOverflow: plan.anchorOverflow,
      knownToolCallIds: plan.knownToolCallIds,
    },
  };
}

describe("replay-order compaction planning", () => {
  it("unpins incident-shaped historical gaps without sibling repair or mutation", () => {
    const entries = [
      anchor("request", "Keep all binding requirements.", "request"),
      call("sibling-only"),
      entry("boundary", user("new direction")),
      ...Array.from({ length: 38 }, (_, i) =>
        entry(`signed_${i}`, assistant(4_000, 5)),
      ),
      entry("recent", user("status?")),
    ];
    const copy = structuredClone(entries);
    const plan = planCompaction(entries, 20_000, { contextWindow: 272_000 });
    assert.equal(plan.status, "ready");
    assert.ok(plan.firstKeptEntryIndex > 1);
    assert.deepEqual(plan.abandonedToolCallIds, ["sibling-only"]);
    assert.ok(plan.retainedTokens < 21_000);
    assert.deepEqual(entries, copy);
    assert.equal(plan.anchors[0].text, "Keep all binding requirements.");
  });
  it("late results are legal and standalone for pairing, but never lead a suffix", () => {
    const entries = [
      entry("old", user("old")),
      call("a"),
      entry("boundary", user("later")),
      result("a", false, "x".repeat(10_000)),
    ];
    const plan = planCompaction(entries, 10);
    assert.equal(plan.firstKeptEntryIndex, 2);
    assert.equal(plan.retentionBudgetExceeded, true);
    assert.throws(() => assertSafeCompactionBoundary(entries, 0, 3), /splits/);
    assert.equal(plan.status, "ready");
    assert.throws(
      () => planCompaction([...entries, result("true-orphan")], 10),
      /orphan/,
    );
  });
  it("metadata is transparent, provider-visible custom/harness boundaries abandon partial batches", () => {
    const metadata = {
      type: "custom" as const,
      id: "meta",
      parentId: null,
      timestamp,
      customType: "metadata",
    };
    const notice = entry("notice", {
      role: "harness",
      eventType: "task_event",
      content: "event",
      timestamp: 0,
    });
    const entries = [
      entry("old", user("old")),
      call("batch", ["a", "b"]),
      metadata,
      result("a"),
      notice,
      result("b"),
    ];
    const plan = planCompaction(entries, 1);
    assert.equal(plan.firstKeptEntryIndex, 4);
    assert.deepEqual(plan.abandonedToolCallIds, ["b"]);
    const protectedPlan = planCompaction(entries, 1, {
      protectedToolCallIds: ["b"],
    });
    assert.equal(protectedPlan.status, "deferred"); // Only the lifecycle caller may release protection, even after a recorded result.
    assert.equal(protectedPlan.firstKeptEntryIndex, 1);
    const pending = planCompaction(entries.slice(0, -1), 1, {
      protectedToolCallIds: ["b"],
    });
    assert.equal(pending.status, "deferred");
    assert.deepEqual(pending.protectedToolCallIds, ["b"]);
    assert.equal(
      planCompaction([entry("old", user("old")), call("pending")], 1).status,
      "deferred",
    );
    const custom = {
      type: "custom_message" as const,
      id: "custom",
      parentId: null,
      timestamp,
      customType: "prompt",
      content: "new prompt",
      display: false,
    };
    assert.deepEqual(
      planCompaction([call("gap"), custom], 1).abandonedToolCallIds,
      ["gap"],
    );
  });
  it("error/aborted assistants close earlier calls but never open replay-dropped proposals", () => {
    for (const reason of ["error", "aborted"] as const) {
      const entries = [
        call("a"),
        call("dropped", ["dropped"], reason),
        entry("new", user("retry")),
      ];
      const plan = planCompaction(entries, 1);
      assert.deepEqual(plan.abandonedToolCallIds, ["a"]);
      assert.deepEqual(plan.knownToolCallIds, ["a"]);
      assert.equal(plan.status, "ready");
      assert.throws(
        () => planCompaction([...entries, result("dropped")], 1),
        /orphan/,
      );
      const late = planCompaction(
        [
          entry("request", user("request")),
          call("a"),
          call("dropped", ["dropped"], reason),
          result("a"),
        ],
        1,
      );
      assert.equal(late.firstKeptEntryIndex, 1); // Dropped assistant cannot become a result-leading suffix.
    }
  });
  it("preserves known proposal lineage across checkpoints and summarizes split-turn prefixes", () => {
    const entries = [
      entry("request", user("request")),
      call("a"),
      entry("kept", user("later")),
    ];
    const plan = planCompaction(entries, 1);
    const next = [
      ...entries,
      persist("cp", entries, plan),
      entry("late-boundary", user("late result incoming")),
      result("a"),
    ];
    assert.equal(planCompaction(next, 1).status, "ready");
    const split = [
      entry("old", user("old")),
      entry("turn", user("do the task")),
      entry("prefix", assistant(100)),
      entry("kept", assistant(100)),
    ];
    const prepared = prepareCompaction(split, {
      enabled: true,
      keepRecentTokens: 100,
      reserveTokens: 1024,
    });
    assert.ok(prepared.ok && prepared.value);
    assert.ok(prepared.value.isSplitTurn);
    assert.equal(prepared.value.turnPrefixMessages.length, 2);
    assert.equal(prepared.value.firstKeptEntryId, "kept");
  });
});

describe("bounded lossless checkpoint anchors", () => {
  it("preserves request/assignment, newest genuine steering and plan path across repeated compactions", () => {
    for (const initialKind of ["request", "assignment"] as const) {
      const initiating =
        "Implement the feature. NEVER change public APIs. Validate the final build.";
      let entries: ConversationTreeEntry[] = [
        anchor("initial", initiating, initialKind),
        anchor("plan", "/tmp/plans/approved.md", "plan"),
        anchor(
          "steer",
          "Use atomic commits and no compatibility shims.",
          "steering",
        ),
        entry("automatic", user("Automatically continue working.")),
        entry("event", {
          role: "harness",
          eventType: "task_event",
          content: "not user steering",
          timestamp: 0,
        }),
        entry("kept", user("x".repeat(400))),
      ];
      const options = { contextWindow: 16_000 };
      for (let i = 0; i < 3; i++) {
        const plan = planCompaction(entries, 1, options);
        assert.equal(plan.status, "ready");
        assert.equal(
          plan.anchors.find((a) => a.sourceEntryId === "initial")?.text,
          initiating,
        );
        assert.ok(
          !plan.anchors.some(
            (a) =>
              a.sourceEntryId === "automatic" || a.sourceEntryId === "event",
          ),
        );
        assert.equal(
          new Set(plan.anchors.map((a) => a.sourceEntryId)).size,
          plan.anchors.length,
        );
        const cp = persist(`cp_${i}`, entries, plan);
        const after = estimatePostCompactionContext(
          entries,
          entries[plan.firstKeptEntryIndex].id,
          cp.summary,
          cp.details,
        );
        entries = [...entries, cp];
        const context = convertToLlm(
          buildConversationContext(entries).messages,
        );
        assert.equal(context.length, 2);
        const text = JSON.stringify(context[0]);
        assert.ok(text.includes(initiating));
        assert.ok(text.includes("/tmp/plans/approved.md"));
        assert.ok(
          text.includes("Use atomic commits and no compatibility shims."),
        );
        assert.equal(
          after.tokensAfter,
          after.summaryTokens + after.retainedTokens,
        );
        assert.ok(after.anchorTokens > 0);
        entries.push(
          anchor(`steering_${i}`, `Newest steering ${i}`, "steering"),
          entry(`kept_${i}`, user("new work")),
        );
      }
    }
  });
  it("selects deterministically by budget, never clips an anchor and records initial overflow", () => {
    const entries = [
      anchor("huge", "binding ".repeat(2000), "request"),
      anchor("plan", "/tmp/approved.md", "plan"),
      anchor("older", "old ".repeat(100), "steering"),
      anchor("newer", "new steering", "steering"),
      entry("kept", user("continue")),
    ];
    const plan = planCompaction(entries, 1, { anchorBudgetTokens: 80 });
    assert.deepEqual(plan.anchorOverflow, [
      { sourceEntryId: "huge", kind: "request" },
    ]);
    assert.ok(
      !plan.anchors.some(
        (a) => a.sourceEntryId === "huge" || a.sourceEntryId === "older",
      ),
    );
    assert.deepEqual(
      plan.anchors.map((a) => a.sourceEntryId),
      ["plan", "newer"],
    );
    assert.deepEqual(
      planCompaction(entries, 1, { anchorBudgetTokens: 80 }).anchors,
      plan.anchors,
    );
    const next = [
      ...entries,
      persist("cp", entries, plan),
      entry("new", user("continue")),
    ];
    assert.deepEqual(
      planCompaction(next, 1, { anchorBudgetTokens: 80 }).anchorOverflow,
      plan.anchorOverflow,
    );
  });
  it("prioritizes a child assignment over a copied parent initiating request", () => {
    const entries = [
      anchor("parent", "Parent request", "request"),
      anchor("child", "Child assignment: change only the parser", "assignment"),
      entry("kept", user("current work")),
    ];
    const plan = planCompaction(entries, 1, { anchorBudgetTokens: 100 });
    assert.deepEqual(
      plan.anchors.map((a) => a.sourceEntryId),
      ["child"],
    );
  });
  it("does not double-count a retained source and excludes absent provenance", () => {
    const entries = [
      entry(
        "unmarked",
        user("this looks important but has unknown provenance"),
      ),
      anchor("initial", "binding request", "request"),
      anchor("recent", "recent steering", "steering"),
    ];
    const plan = planCompaction(entries, 1, { anchorBudgetTokens: 100 });
    assert.deepEqual(
      plan.anchors.map((a) => a.sourceEntryId),
      ["initial"],
    );
    const cp = persist("cp", entries, plan);
    const text = JSON.stringify(
      convertToLlm(buildConversationContext([...entries, cp]).messages),
    );
    assert.equal(text.match(/recent steering/g)?.length, 1);
  });
});

it("annotates success, error, abandoned and unknown outcomes with bounded evidence and references", () => {
  const messages = convertToLlm(
    buildConversationContext([
      call("ok"),
      result("ok"),
      call("bad"),
      result("bad", true, "x".repeat(5000) + "\n/tmp/artifact.txt"),
      call("gap"),
      entry("boundary", user("continue")),
      call("unknown"),
    ]).messages,
  );
  const text = serializeConversation(messages);
  assert.match(text, /id=ok name=read outcome=success/);
  assert.match(text, /id=bad name=read outcome=error/);
  assert.match(
    text,
    /id=gap name=read outcome=abandoned \(no recorded result on this path\)/,
  );
  assert.match(text, /id=unknown name=read outcome=unknown/);
  assert.match(text, /truncated; omitted evidence does not prove success/);
  assert.match(text, /\/tmp\/artifact.txt/);
  assert.ok(text.length < 4000);
});

it("checks advancing cuts, actual reduction, summary ceiling, anchors and pending prompts before/after generation", () => {
  const base = {
    tokensBefore: 1000,
    retainedTokens: 300,
    checkpointTokens: 200,
    advances: true,
  };
  assert.equal(assessCompactionUsefulness(base).useful, true);
  assert.equal(
    assessCompactionUsefulness({ ...base, advances: false }).reason,
    "no_new_history",
  );
  assert.equal(
    assessCompactionUsefulness({ ...base, checkpointTokens: 700 }).reason,
    "ineffective",
  );
  assert.equal(
    assessCompactionUsefulness({
      ...base,
      thresholdTokens: 600,
      pendingPromptTokens: 100,
    }).reason,
    "ineffective",
  );
  assert.equal(
    assessCompactionUsefulness({
      ...base,
      thresholdTokens: 600,
      pendingPromptTokens: 99,
    }).useful,
    true,
  );
  assert.equal(
    assessCompactionUsefulness({
      ...base,
      checkpointTokens: 300,
      thresholdTokens: 600,
    }).useful,
    false,
  );
  const settings = deriveManualCompactionSettings(8000, {
    auto: false,
    profile: "balanced",
    customTriggerPercent: 80,
    customKeepRecentPercent: 15,
  });
  assert.equal(settings.enabled, true);
  assert.ok(settings.reserveTokens < 8000 && settings.keepRecentTokens < 8000);
});

it("intentionally compares pi-ai replay gap semantics (upgrades must fail on semantic change)", async (t) => {
  // Test-only private API import. A pi-ai upgrade changing replay semantics should intentionally fail this test.
  const specifier = "@earendil-works/pi-ai/api/transform-messages.js";
  let transform: (messages: Message[], model: unknown) => Message[];
  try {
    const module = await import(specifier).catch(async (error) => {
      if (
        !["ERR_PACKAGE_PATH_NOT_EXPORTED", "ERR_MODULE_NOT_FOUND"].includes(
          error.code,
        )
      )
        throw error;
      // Some versions' wildcard export appends .js, making the requested spelling resolve to .js.js.
      return import(
        new URL(
          "./api/transform-messages.js",
          import.meta.resolve("@earendil-works/pi-ai"),
        ).href
      );
    });
    transform = module.transformMessages;
  } catch (error) {
    if ((error as { code?: string }).code === "ERR_MODULE_NOT_FOUND") {
      t.skip("pi-ai private transform module unavailable");
      return;
    }
    throw error;
  }
  const model = {
    input: ["text"],
    provider: "openai-codex",
    api: "openai-codex-responses",
    id: "test",
  };
  const entries = [
    call("gap"),
    entry("boundary", user("continue")),
    result("gap"),
    call("partial", ["a", "b"]),
    result("a"),
    call("failed", ["dropped"], "error"),
    entry("recent", user("retry")),
  ];
  const plan = planCompaction(entries, 1);
  const replay = transform(
    convertToLlm(buildConversationContext(entries).messages),
    model,
  );
  const syntheticIds = replay
    .filter(
      (m) =>
        m.role === "toolResult" &&
        m.content.some(
          (b) => b.type === "text" && b.text === "No result provided",
        ),
    )
    .map((m) => (m.role === "toolResult" ? m.toolCallId : ""));
  assert.deepEqual(syntheticIds, plan.abandonedToolCallIds);
  assert.ok(
    !replay.some(
      (m) =>
        m.role === "assistant" &&
        m.content.some((b) => b.type === "toolCall" && b.id === "dropped"),
    ),
  );
  assert.equal(
    replay.filter((m) => m.role === "toolResult" && m.toolCallId === "gap")
      .length,
    2,
  );
});
