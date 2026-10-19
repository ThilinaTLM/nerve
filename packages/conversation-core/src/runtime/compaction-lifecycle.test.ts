import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { mock } from "node:test";
import {
  getModelRegistry,
  registerAgentScriptedProvider,
} from "@nervekit/harness/models";
import { ConversationCore } from "../core.js";
import type { CoreChange } from "./core-change.js";
import {
  createConversation,
  options,
  waitUntil,
} from "./lifecycle-test-helpers.js";

const summary = [
  "Goal",
  "Requirements and Constraints",
  "Work Completed",
  "Work Remaining",
  "Key Decisions",
  "Current Working State",
  "Continuation Plan",
  "Critical References",
]
  .map((heading) => `## ${heading}\nHistory checkpoint.`)
  .join("\n\n");

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

async function fixture(
  steps: Parameters<typeof registerAgentScriptedProvider>[0]["steps"],
  failRequest?: number,
  historyRepeats = 1000,
) {
  const directory = await mkdtemp(
    join(tmpdir(), "nerve-compaction-lifecycle-"),
  );
  const provider = registerAgentScriptedProvider({
    provider: `compaction-${randomUUID()}`,
    steps,
  });
  const model = provider.getModel("scripted-fast")!;
  const opts = options(
    directory,
    join(directory, "core.sqlite"),
    {
      resolve: async () => ({ model: { ...model, contextWindow: 100_000 } }),
    },
    {
      execute: async () => {
        throw new Error("No tools expected");
      },
      isReplaySafe: () => false,
    },
  );
  const core = new ConversationCore(opts);
  await core.start();
  await createConversation(core, "conversation");
  for (let index = 0; index < 10; index++) {
    opts.storage.events.append({
      id: `history_${index}`,
      conversationId: "conversation",
      type: "user_message",
      llmRepresentation: "user",
      turnId: null,
      inputId: null,
      payload: {
        text: `Message ${index}: ${"history ".repeat(historyRepeats)}`,
        originalText: "History",
        commandPreparation: null,
        source: "user",
        senderConversationId: null,
      },
      createdAt: new Date().toISOString(),
    });
  }
  const changes: CoreChange[] = [];
  core.subscribe((change) => changes.push(change));
  const gates: ReturnType<typeof deferred>[] = [];
  const registry = getModelRegistry();
  const original = registry.streamSimple;
  // Delay consumption after a real provider text_delta. generateSummary still owns
  // accumulation and attempt numbering; this is not synthetic progress injection.
  const stream = mock.method(
    registry,
    "streamSimple",
    (...args: Parameters<typeof original>) => {
      const target = original.apply(registry, args);
      const gate = deferred();
      const request = gates.length;
      gates.push(gate);
      return new Proxy(target, {
        get(target, key) {
          if (key === Symbol.asyncIterator)
            return async function* () {
              let paused = false;
              for await (const event of target) {
                yield event;
                if (
                  !paused &&
                  event.type === "text_delta" &&
                  event.delta.length > 0
                ) {
                  paused = true;
                  await gate.promise;
                  if (request === failRequest)
                    throw new Error("Provider stream failed");
                }
              }
            };
          const value: unknown = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
  );
  return {
    core,
    changes,
    opts,
    gates,
    cleanup: async () => {
      await core.close();
      for (const gate of gates) gate.resolve();
      stream.mock.restore();
      provider.unregister();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

void test("manual compaction snapshots real streaming and repair replacement, committing one stable event", async () => {
  const f = await fixture([
    { type: "assistantText", text: "Invalid first checkpoint" },
    { type: "assistantText", text: summary },
  ]);
  try {
    const compact = f.core.compact("conversation");
    await compact;
    const started = f.core.getSnapshot("conversation").compaction!;
    assert.equal(started.status, "running");
    assert.equal(
      f.core.getSnapshot("conversation").conversation.status,
      "running",
    );
    assert.equal(started.reason, "manual");
    assert.equal(started.executionId, undefined);
    assert.equal(started.headEventId, "history_9");
    await waitUntil(
      () => !!f.core.getSnapshot("conversation").compaction?.summaryPreview,
    );
    const first = f.core.getSnapshot("conversation").compaction!;
    assert.match(first.summaryPreview, /Invalid/);
    assert.equal(first.attempt, 1);
    assert.throws(
      () =>
        f.core.submitInput({
          conversationId: "conversation",
          inputId: "inline",
          text: "!echo unsafe",
          source: "user",
        }),
      /compacting/,
    );
    assert.throws(() => f.core.selectHead("conversation", null), /compacting/);
    f.core.compact("conversation");
    assert.equal(f.core.getSnapshot("conversation").compaction?.id, started.id);
    f.core.configure("conversation", { instructions: "Next request" });
    f.core.inputs.enqueueNotice({
      conversationId: "conversation",
      inputId: "system",
      subtype: "sub_conversation_event",
      producer: "conv_child",
      text: "System notice",
      details: {
        childConversationId: "conv_child",
        assignmentId: "input_assignment",
        status: "completed",
        assetIds: [],
      },
      wakeWhenIdle: false,
    });
    assert.equal(f.core.getSnapshot("conversation").queue.length, 1);
    f.gates[0]!.resolve();
    await waitUntil(
      () => f.core.getSnapshot("conversation").compaction?.attempt === 2,
    );
    const repaired = f.core.getSnapshot("conversation").compaction!;
    assert.equal(repaired.id, first.id);
    assert.ok(repaired.revision > first.revision);
    assert.ok(!repaired.summaryPreview.includes("Invalid"));
    f.gates[1]!.resolve();
    await waitUntil(
      () =>
        f.core.getSnapshot("conversation").compaction?.status === "completed",
    );
    const completed = f.core.getSnapshot("conversation").compaction!;
    assert.equal(completed.status, "completed");
    assert.equal(completed.eventId, started.id);
    assert.equal(completed.summaryPreview, summary);
    const events = f.core.getEventsSince("conversation", 0);
    assert.equal(
      events.filter((event) => event.type === "compaction").length,
      1,
    );
    assert.equal(
      events.find((event) => event.type === "compaction")?.id,
      started.id,
    );
    assert.equal(
      events.filter(
        (event) =>
          event.type === "system_event" &&
          event.payload.subtype === "execution_state",
      ).length,
      0,
    );
    const eventIndex = f.changes.findIndex(
      (change) =>
        change.kind === "event_appended" && change.event.id === started.id,
    );
    const terminalIndex = f.changes.findIndex(
      (change) =>
        change.kind === "compaction_changed" &&
        change.compaction.status === "completed",
    );
    assert.ok(eventIndex >= 0 && terminalIndex > eventIndex);
    await waitUntil(
      () => f.core.getSnapshot("conversation").conversation.status === "idle",
    );
    await f.core.delete("conversation");
    await createConversation(f.core, "conversation");
    assert.equal(f.core.getSnapshot("conversation").compaction, null);
  } finally {
    await f.cleanup();
  }
});

for (const outcome of ["failed", "cancelled"] as const) {
  void test(`${outcome} compaction retains uncommitted draft and fences late provider chunks`, async () => {
    const f = await fixture(
      [
        { type: "assistantText", text: "Invalid first checkpoint" },
        { type: "assistantText", text: "Repair draft before provider failure" },
      ],
      outcome === "failed" ? 1 : undefined,
    );
    try {
      const compact = f.core.compact("conversation");
      await compact;
      await waitUntil(
        () => !!f.core.getSnapshot("conversation").compaction?.summaryPreview,
      );
      let draft = f.core.getSnapshot("conversation").compaction!.summaryPreview;
      if (outcome === "cancelled") {
        const stop = f.core.stop("conversation");
        assert.equal(
          f.core.getSnapshot("conversation").compaction?.status,
          "stopping",
        );
        assert.throws(
          () =>
            f.core.submitInput({
              conversationId: "conversation",
              inputId: "blocked",
              text: "!echo unsafe",
              source: "user",
            }),
          /compacting/,
        );
        await stop;
      } else {
        f.gates[0]!.resolve();
        await waitUntil(() => {
          const operation = f.core.getSnapshot("conversation").compaction;
          return operation?.attempt === 2 && !!operation.summaryPreview;
        });
        draft = f.core.getSnapshot("conversation").compaction!.summaryPreview;
        assert.match(draft, /Repair/);
        f.gates[1]!.resolve();
      }
      await waitUntil(
        () => f.core.getSnapshot("conversation").compaction?.status === outcome,
      );
      const terminal = f.core.getSnapshot("conversation").compaction!;
      assert.equal(terminal.status, outcome);
      assert.equal(terminal.summaryPreview, draft);
      assert.ok(terminal.endedAt);
      if (outcome === "failed") assert.ok(terminal.errorMessage);
      assert.equal(
        f.core.getSnapshot("conversation").conversation.headEventId,
        "history_9",
      );
      assert.equal(
        f.core
          .getEventsSince("conversation", 0)
          .filter((event) => event.type === "compaction").length,
        0,
      );
      f.gates[0]!.resolve();
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.deepEqual(f.core.getSnapshot("conversation").compaction, terminal);
      f.core.submitInput({
        conversationId: "conversation",
        inputId: "accepted",
        text: "Hello",
        source: "user",
        wakeWhenIdle: false,
      });
    } finally {
      await f.cleanup();
    }
  });
}

void test("stop immediately after acceptance settles a reserved manual operation", async () => {
  const f = await fixture([{ type: "assistantText", text: summary }]);
  try {
    const compact = f.core.compact("conversation");
    await compact;
    await f.core.stop("conversation");

    assert.equal(
      f.core.getSnapshot("conversation").compaction?.status,
      "cancelled",
    );
    assert.equal(f.gates.length, 0);
  } finally {
    await f.cleanup();
  }
});

for (const reason of ["threshold", "overflow"] as const) {
  void test(`${reason} compaction shares lifecycle and existing execution`, async () => {
    const f = await fixture(
      [
        ...(reason === "overflow"
          ? [
              {
                type: "providerError" as const,
                message: "maximum context length exceeded",
              },
            ]
          : []),
        { type: "assistantText", text: summary },
        { type: "assistantText", text: "Done" },
      ],
      undefined,
      reason === "threshold" ? 6000 : 1000,
    );
    try {
      f.core.continue("conversation");
      await waitUntil(
        () => !!f.core.getSnapshot("conversation").compaction?.summaryPreview,
      );
      const operation = f.core.getSnapshot("conversation").compaction!;
      assert.equal(operation.reason, reason);
      assert.equal(operation.status, "running");
      const started = f.core
        .getEventsSince("conversation", 0)
        .find(
          (event) =>
            event.type === "system_event" &&
            event.payload.subtype === "execution_state" &&
            event.payload.transition === "started",
        );
      assert.equal(operation.executionId, started?.id);
      assert.ok(operation.executionId);
      assert.equal(
        f.core.getSnapshot("conversation").conversation.status,
        "running",
      );
      const summaryRequest = reason === "overflow" ? 1 : 0;
      f.gates[summaryRequest]!.resolve();
      await waitUntil(() => f.gates.length > summaryRequest + 1);
      f.gates[summaryRequest + 1]!.resolve();
      await waitUntil(
        () => f.core.getSnapshot("conversation").conversation.status === "idle",
      );
      assert.equal(
        f.core.getSnapshot("conversation").compaction?.status,
        "completed",
      );
      assert.equal(
        f.core
          .getEventsSince("conversation", 0)
          .filter(
            (event) =>
              event.type === "system_event" &&
              event.payload.subtype === "execution_state" &&
              event.payload.transition === "started",
          ).length,
        1,
      );
    } finally {
      await f.cleanup();
    }
  });
}

void test("a Stop racing committed-event publication cannot turn completion into cancellation", async () => {
  const f = await fixture([{ type: "assistantText", text: summary }]);
  let stop: Promise<void> | undefined;
  f.core.subscribe((change) => {
    if (change.kind === "event_appended" && change.event.type === "compaction")
      stop = f.core.stop("conversation");
  });
  try {
    const compact = f.core.compact("conversation");
    await compact;
    await waitUntil(
      () => !!f.core.getSnapshot("conversation").compaction?.summaryPreview,
    );
    f.gates[0]!.resolve();
    await waitUntil(
      () =>
        f.core.getSnapshot("conversation").compaction?.status === "completed",
    );
    await stop;
    assert.equal(
      f.core.getSnapshot("conversation").compaction?.status,
      "completed",
    );
    assert.equal(f.core.getSnapshot("conversation").conversation.paused, true);
  } finally {
    await f.cleanup();
  }
});

void test("prompts and wake notices accepted during compaction follow the checkpoint without idle", async () => {
  const f = await fixture([
    { type: "assistantText", text: summary },
    { type: "assistantText", text: "Done" },
  ]);
  try {
    assert.equal(f.core.compact("conversation"), undefined);
    await waitUntil(
      () => !!f.core.getSnapshot("conversation").compaction?.summaryPreview,
    );
    f.core.submitInput({
      conversationId: "conversation",
      inputId: "during",
      text: "Next",
      source: "user",
    });
    f.core.inputs.enqueueNotice({
      conversationId: "conversation",
      inputId: "notice",
      subtype: "sub_conversation_event",
      producer: "child",
      text: "Notice",
      details: {
        childConversationId: "child",
        assignmentId: "assignment",
        status: "completed",
        assetIds: [],
      },
      wakeWhenIdle: true,
    });
    assert.equal(f.core.getSnapshot("conversation").queue.length, 2);
    f.gates[0]!.resolve();
    await waitUntil(() => f.gates.length === 2);
    assert.ok(
      f.changes
        .filter((c) => c.kind === "conversation_changed")
        .every((c) => c.summary.status === "running"),
    );
    f.gates[1]!.resolve();
    await waitUntil(
      () => f.core.getSnapshot("conversation").conversation.status === "idle",
    );
    const events = f.core.getEventsSince("conversation", 0);
    const checkpoint = events.findIndex((e) => e.type === "compaction");
    for (const input of ["during", "notice"]) {
      assert.equal(events.filter((e) => e.inputId === input).length, 1);
      assert.ok(events.findIndex((e) => e.inputId === input) > checkpoint);
    }
    assert.equal(f.gates.length, 2);
  } finally {
    await f.cleanup();
  }
});

void test("paused compaction runs alone and preserves pause and held inputs", async () => {
  const f = await fixture([{ type: "assistantText", text: summary }]);
  try {
    f.core.submitInput({
      conversationId: "conversation",
      inputId: "held",
      text: "Held",
      source: "user",
      wakeWhenIdle: false,
    });
    f.core.pause("conversation");
    f.core.compact("conversation");
    await waitUntil(
      () => !!f.core.getSnapshot("conversation").compaction?.summaryPreview,
    );
    f.gates[0]!.resolve();
    await waitUntil(
      () => f.core.getSnapshot("conversation").conversation.status === "idle",
    );
    assert.equal(f.core.getSnapshot("conversation").conversation.paused, true);
    assert.equal(f.core.getSnapshot("conversation").queue.length, 1);
    assert.equal(f.gates.length, 1);
    assert.equal(
      f.core
        .getEventsSince("conversation", 0)
        .filter(
          (e) =>
            e.type === "system_event" &&
            e.payload.subtype === "execution_state",
        ).length,
      0,
    );
  } finally {
    await f.cleanup();
  }
});

for (const cancel of ["stop", "forcePush", "cancelCompaction"] as const) {
  void test(`${cancel} cancels a queued request during a model turn`, async () => {
    const f = await fixture([
      { type: "assistantText", text: "Final response" },
    ]);
    try {
      f.core.continue("conversation");
      await waitUntil(() => f.gates.length === 1);
      f.core.compact("conversation");
      const queued = f.core.getSnapshot("conversation").compaction!;
      assert.equal(queued.status, "queued");
      f.core.compact("conversation");
      assert.equal(
        f.core.getSnapshot("conversation").compaction?.id,
        queued.id,
      );
      await f.core[cancel]("conversation");
      assert.equal(
        f.core.getSnapshot("conversation").compaction?.status,
        "cancelled",
      );
      f.gates[0]!.resolve();
      await waitUntil(
        () => f.core.getSnapshot("conversation").conversation.status === "idle",
      );
      assert.equal(f.gates.length, 1);
      assert.equal(
        f.core
          .getEventsSince("conversation", 0)
          .filter((e) => e.type === "compaction").length,
        0,
      );
    } finally {
      await f.cleanup();
    }
  });
}

void test("final-turn request runs standalone after completion without another model turn", async () => {
  const f = await fixture([
    { type: "assistantText", text: "Final response" },
    { type: "assistantText", text: summary },
  ]);
  try {
    f.core.continue("conversation");
    await waitUntil(() => f.gates.length === 1);
    f.core.compact("conversation");
    f.gates[0]!.resolve();
    await waitUntil(
      () => !!f.core.getSnapshot("conversation").compaction?.summaryPreview,
    );
    assert.equal(
      f.core.getSnapshot("conversation").compaction?.executionId,
      undefined,
    );
    assert.ok(
      f.changes
        .filter((c) => c.kind === "conversation_changed")
        .every((c) => c.summary.status === "running"),
    );
    f.gates[1]!.resolve();
    await waitUntil(
      () => f.core.getSnapshot("conversation").conversation.status === "idle",
    );
    const events = f.core.getEventsSince("conversation", 0);
    const completed = events.findIndex(
      (e) =>
        e.type === "system_event" &&
        e.payload.subtype === "execution_state" &&
        e.payload.transition === "completed",
    );
    assert.ok(completed >= 0);
    assert.ok(events.findIndex((e) => e.type === "compaction") > completed);
    assert.equal(f.gates.length, 2);
  } finally {
    await f.cleanup();
  }
});

for (const fail of [false, true]) {
  void test(`turn-boundary compaction ${fail ? "failure continues execution" : "orders A, checkpoint, B"}`, async () => {
    const f = await fixture(
      [
        {
          type: "toolCalls",
          calls: [{ id: "tool", name: "bash", args: { command: "wait" } }],
        },
        { type: "assistantText", text: summary },
        { type: "assistantText", text: "Done" },
      ],
      fail ? 1 : undefined,
    );
    const tool = deferred();
    let executing = false;
    f.opts.toolHost.execute = async () => {
      executing = true;
      await tool.promise;
      return { kind: "completed", result: { content: "Done" } };
    };
    try {
      f.core.continue("conversation");
      await waitUntil(() => executing);
      f.core.submitInput({
        conversationId: "conversation",
        inputId: "A",
        text: "Before",
        source: "user",
      });
      f.core.compact("conversation");
      f.core.submitInput({
        conversationId: "conversation",
        inputId: "B",
        text: "After",
        source: "user",
      });
      tool.resolve();
      await waitUntil(
        () => !!f.core.getSnapshot("conversation").compaction?.summaryPreview,
      );
      assert.ok(f.core.getSnapshot("conversation").compaction?.executionId);
      f.gates[1]!.resolve();
      await waitUntil(() => f.gates.length === 3);
      f.gates[2]!.resolve();
      await waitUntil(
        () => f.core.getSnapshot("conversation").conversation.status === "idle",
      );
      const events = f.core.getEventsSince("conversation", 0);
      assert.equal(
        f.core.getSnapshot("conversation").compaction?.status,
        fail ? "failed" : "completed",
      );
      const a = events.findIndex((e) => e.inputId === "A");
      const b = events.findIndex((e) => e.inputId === "B");
      assert.ok(a >= 0 && b > a);
      if (!fail) {
        const checkpoint = events.findIndex((e) => e.type === "compaction");
        assert.ok(a < checkpoint && checkpoint < b);
      }
      assert.equal(
        events.filter((e) => e.type === "assistant_message").length,
        2,
      );
      assert.equal(f.gates.length, 3);
    } finally {
      tool.resolve();
      await f.cleanup();
    }
  });
}

void test("standalone child compaction emits no execution or assignment-completed events", async () => {
  const f = await fixture([{ type: "assistantText", text: summary }]);
  try {
    const config = f.core.getSnapshot("conversation").config;
    await f.core.createConversation({
      id: "child",
      projectId: "proj_test",
      parentConversationId: "conversation",
      config: { ...config, permissionRuleSetId: "autonomous" },
    });
    for (const event of f.opts.storage.events.since("conversation", 0)) {
      if (event.type !== "user_message") continue;
      f.opts.storage.events.append({
        id: `child_${event.id}`,
        conversationId: "child",
        type: "user_message",
        llmRepresentation: "user",
        turnId: null,
        inputId: null,
        payload: event.payload,
        createdAt: event.createdAt,
      });
    }
    let finished = 0;
    f.core.onExecutionFinished(() => {
      finished++;
    });
    const parentQueue = f.core.getSnapshot("conversation").queue;
    f.core.compact("child");
    await waitUntil(
      () => !!f.core.getSnapshot("child").compaction?.summaryPreview,
    );
    f.gates[0]!.resolve();
    await waitUntil(
      () => f.core.getSnapshot("child").conversation.status === "idle",
    );
    assert.equal(finished, 0);
    assert.equal(f.core.getSnapshot("child").compaction?.status, "completed");
    assert.equal(
      f.core
        .getEventsSince("child", 0)
        .filter(
          (e) =>
            e.type === "system_event" &&
            e.payload.subtype === "execution_state",
        ).length,
      0,
    );
    assert.deepEqual(f.core.getSnapshot("conversation").queue, parentQueue);
    assert.equal(f.gates.length, 1);
  } finally {
    await f.cleanup();
  }
});

void test("pending compaction bypasses pause with a waiting execution without resuming it", async () => {
  const f = await fixture([{ type: "assistantText", text: summary }]);
  try {
    f.core.pause("conversation");
    for (const [id, payload] of [
      ["execution", { subtype: "execution_state", transition: "started" }],
      [
        "waiting",
        {
          subtype: "execution_state",
          transition: "waiting",
          executionId: "execution",
        },
      ],
    ] as const) {
      f.opts.storage.events.append({
        id,
        conversationId: "conversation",
        type: "system_event",
        llmRepresentation: "none",
        turnId: null,
        inputId: null,
        payload,
        createdAt: new Date().toISOString(),
      });
    }
    f.core.compact("conversation");
    await waitUntil(
      () => !!f.core.getSnapshot("conversation").compaction?.summaryPreview,
    );
    f.gates[0]!.resolve();
    await waitUntil(
      () =>
        f.core.getSnapshot("conversation").compaction?.status === "completed",
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(f.core.getSnapshot("conversation").conversation.paused, true);
    assert.equal(
      f.core.getSnapshot("conversation").compaction?.executionId,
      undefined,
    );
    assert.equal(
      f.core
        .getEventsSince("conversation", 0)
        .filter(
          (e) =>
            e.type === "system_event" &&
            e.payload.subtype === "execution_state",
        ).length,
      2,
    );
    assert.equal(f.gates.length, 1);
  } finally {
    await f.cleanup();
  }
});
