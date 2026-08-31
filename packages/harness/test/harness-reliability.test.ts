import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { continueHarnessRun } from "../src/harness/run/continuation.js";
import { InMemoryConversationStorage } from "../src/conversation/adapters/in-memory-storage.js";
import type { ConversationTreeEntry } from "../src/conversation/entries.js";

describe("harness continuation setup", () => {
  it("returns to idle and settles waiters when turn-state creation fails", async () => {
    let settled = false;
    let flushed = false;
    const state = {
      phase: "idle",
      startRunPromise() {
        return () => {
          settled = true;
        };
      },
      async createTurnState() {
        throw new Error("model setup failed");
      },
      createContext() {},
      createLoopConfig() {},
      async handleAgentEvent() {},
      createStreamFn() {},
      async emitRunFailure() {
        throw new Error("must not report without a model");
      },
      async flushPendingConversationWrites() {
        flushed = true;
      },
    };

    await assert.rejects(
      continueHarnessRun(state as never),
      /model setup failed/,
    );
    assert.equal(state.phase, "idle");
    assert.equal(settled, true);
    assert.equal(flushed, true);
  });
});

describe("conversation tree validation", () => {
  const entry = (
    id: string,
    parentId: string | null,
  ): ConversationTreeEntry => ({
    type: "conversation_info",
    id,
    parentId,
    timestamp: "2026-01-01T00:00:00.000Z",
  });

  it("rejects duplicate and forward parent IDs", () => {
    assert.throws(
      () =>
        new InMemoryConversationStorage({
          entries: [entry("one", null), entry("one", null)],
        }),
      /Duplicate entry id one/,
    );
    assert.throws(
      () =>
        new InMemoryConversationStorage({
          entries: [entry("child", "parent"), entry("parent", null)],
        }),
      /missing parent parent/,
    );
  });

  it("rejects invalid append links without corrupting storage", async () => {
    const storage = new InMemoryConversationStorage({
      entries: [entry("root", null)],
    });
    await assert.rejects(
      storage.appendEntry(entry("child", "missing")),
      /missing parent missing/,
    );
    assert.deepEqual(
      (await storage.getEntries()).map((item) => item.id),
      ["root"],
    );
  });
});
