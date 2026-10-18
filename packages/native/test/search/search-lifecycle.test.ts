import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import test from "node:test";
import type {
  NativeFileCompletionIndexHandle,
  NativeSearchDocument,
} from "../../src/search/binding.js";
import { wrapSearchIndex } from "../../src/search/search-index.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fake() {
  const state = {
    live: new Map<string, NativeSearchDocument>(),
    staged: new Map<string, NativeSearchDocument>(),
    remove: [] as string[],
    revision: 0,
    stages: 0,
    failStageAt: 0,
    discards: 0,
    discardedCount: 0,
    closes: 0,
    closed: false,
    stageStarted: deferred(),
    stageGate: undefined as ReturnType<typeof deferred> | undefined,
    disposalGate: undefined as ReturnType<typeof deferred> | undefined,
  };
  const check = () => {
    if (state.closed) throw new Error("closed");
  };
  const handle: NativeFileCompletionIndexHandle = {
    build: async () => 0,
    async stage(documents, remove) {
      check();
      state.stages++;
      if (state.stages === state.failStageAt)
        throw new Error("synthetic stage failure");
      for (const document of documents) state.staged.set(document.id, document);
      state.remove.push(...remove);
      state.stageStarted.resolve();
      await state.stageGate?.promise;
      check();
      return 0;
    },
    async discard() {
      state.discards++;
      state.discardedCount = state.staged.size;
      check();
      state.staged.clear();
      state.remove = [];
      return 0;
    },
    async commit() {
      check();
      for (const id of state.remove) state.live.delete(id);
      for (const [id, document] of state.staged) state.live.set(id, document);
      state.staged.clear();
      state.remove = [];
      return ++state.revision;
    },
    query: async () => [],
    search: async () => {
      check();
      return { revision: state.revision, items: [] };
    },
    async close() {
      state.closes++;
      state.closed = true;
      state.staged.clear();
      state.remove = [];
      state.stageGate?.resolve();
      await state.disposalGate?.promise;
    },
  };
  return { state, handle };
}
const document = (id: string) => ({
  id,
  kind: "opaque",
  fields: [{ key: "name" as const, text: "value" }],
});

test("failure after successful staging discards the entire update before the next request", async () => {
  const { state, handle } = fake();
  const index = wrapSearchIndex(handle);
  try {
    await index.update({ upsert: [document("old")], remove: [] });
    state.stages = 0;
    state.failStageAt = 2;
    await assert.rejects(
      index.update({
        upsert: Array.from({ length: 2050 }, (_, i) => document(`new:${i}`)),
        remove: ["old"],
      }),
      /synthetic stage failure/,
    );
    assert.ok(
      state.discardedCount > 0,
      "first stage succeeded before injected second-stage failure",
    );
    assert.equal(state.discards, 1);
    assert.equal(state.staged.size, 0);
    assert.equal((await index.query({ text: "" })).revision, 1);
    assert.deepEqual([...state.live.keys()], ["old"]);
    state.failStageAt = 0;
    await index.update({ upsert: [document("next")], remove: ["old"] });
    assert.deepEqual([...state.live.keys()], ["next"]);
    assert.equal(state.revision, 2);
  } finally {
    await index.close();
  }
});

test("lifetime abort closes active staged and queued work and awaits disposal", async () => {
  const { state, handle } = fake();
  state.stageGate = deferred();
  state.disposalGate = deferred();
  const controller = new AbortController();
  const index = wrapSearchIndex(handle, { signal: controller.signal });
  assert.equal(getEventListeners(controller.signal, "abort").length, 1);
  const active = assert.rejects(
    index.update({ upsert: [document("staged")], remove: [] }),
    /closed/,
  );
  await state.stageStarted.promise;
  assert.equal(state.staged.size, 1);
  const queued = assert.rejects(index.query({ text: "value" }), /closed/);
  controller.abort();
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  let disposed = false;
  const closing = index.close().then(() => {
    disposed = true;
  });
  await active;
  await queued;
  assert.equal(disposed, false);
  state.disposalGate.resolve();
  await closing;
  assert.equal(state.staged.size, 0);
  assert.equal(state.closes, 1);
  await assert.rejects(index.query({ text: "" }), /closed/);
});

test("explicit close detaches the caller abort listener", async () => {
  const { state, handle } = fake();
  const controller = new AbortController();
  const index = wrapSearchIndex(handle, { signal: controller.signal });
  await index.close();
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  controller.abort();
  await index.close();
  assert.equal(state.closes, 1);
});

test("ID filters validate before enqueue and snapshot bounded opaque IDs while waiting", async () => {
  const { state, handle } = fake();
  const calls: (string[] | undefined)[] = [];
  handle.search = async (_query, _kinds, _limit, ids) => {
    calls.push(ids);
    return { revision: state.revision, items: [] };
  };
  const index = wrapSearchIndex(handle);
  try {
    for (const documentIds of [
      Array(257).fill("id"),
      [""],
      ["x".repeat(1025)],
      [undefined],
      new Array(1),
      null,
    ])
      await assert.rejects(
        index.query({ text: "same", documentIds: documentIds as string[] }),
        /documentIds/,
      );
    assert.equal(calls.length, 0);
    state.stageGate = deferred();
    const update = index.update({ upsert: [document("id")], remove: [] });
    await state.stageStarted.promise;
    const ids = ["opaque:\ud800", "duplicate", "duplicate"];
    const pending = index.query({ text: "same", documentIds: ids });
    ids.fill("mutated");
    state.stageGate.resolve();
    await update;
    assert.equal((await pending).revision, 1);
    assert.deepEqual(calls, [["opaque:\ud800", "duplicate", "duplicate"]]);
    await index.query({ text: "" });
    await index.query({ text: "", documentIds: [] });
    assert.deepEqual(calls.slice(1), [undefined, []]);
  } finally {
    await index.close();
  }
});
