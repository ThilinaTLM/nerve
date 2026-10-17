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
    void compact.catch(() => {});
    const started = f.core.getSnapshot("conversation").compaction!;
    assert.equal(started.status, "running");
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
          inputId: "blocked",
          text: "Hello",
          source: "user",
        }),
      /compacting/,
    );
    assert.throws(
      () =>
        f.core.submitInput({
          conversationId: "conversation",
          inputId: "inline",
          text: "/bash echo unsafe",
          source: "user",
        }),
      /compacting/,
    );
    assert.throws(() => f.core.selectHead("conversation", null), /compacting/);
    await assert.rejects(f.core.compact("conversation"), /compacting/);
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
    await compact;
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
      const rejected = assert.rejects(compact);
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
              text: "Hello",
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
      await rejected;
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
    const rejected = assert.rejects(compact);
    await f.core.stop("conversation");
    await rejected;
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
    void compact.catch(() => {});
    await waitUntil(
      () => !!f.core.getSnapshot("conversation").compaction?.summaryPreview,
    );
    f.gates[0]!.resolve();
    await compact;
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
