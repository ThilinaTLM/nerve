import assert from "node:assert/strict";
import { test } from "node:test";
import type { ConversationAgentUsage } from "@nervekit/contracts/core";
import {
  ConversationAgentUsageController,
  type AgentUsageState,
} from "./conversation-agent-usage.js";

function result(subagentCount = 0): ConversationAgentUsage {
  const summary = {
    responseCount: 1,
    input: 10,
    output: 2,
    cacheRead: 5,
    cacheWrite: 3,
    totalTokens: 20,
    cost: 0,
  };
  return { own: summary, subagents: summary, total: summary, subagentCount };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function setup(fetch: (id: string) => Promise<ConversationAgentUsage>) {
  let state: AgentUsageState = { loading: false };
  let tick: (() => void) | undefined;
  const controller = new ConversationAgentUsageController({
    fetch,
    publish: (next) => {
      state = next;
    },
    schedule: (callback, delay) => {
      assert.equal(delay, 3000);
      tick = callback;
      return () => {
        if (tick === callback) tick = undefined;
      };
    },
  });
  return {
    controller,
    state: () => state,
    tick: () => {
      const callback = tick;
      tick = undefined;
      callback?.();
    },
    scheduled: () => !!tick,
  };
}

test("usage polling runs only while enabled and stops on close/dispose", async () => {
  let requests = 0;
  const h = setup(async () => {
    requests++;
    return result();
  });
  h.controller.configure("lead", false);
  assert.equal(requests, 0);
  h.controller.configure("lead", true);
  assert.equal(h.state().loading, true);
  await flush();
  assert.equal(requests, 1);
  assert.ok(h.scheduled());
  h.tick();
  await flush();
  assert.equal(requests, 2);
  h.controller.configure("lead", false);
  assert.equal(h.scheduled(), false);
  h.tick();
  assert.equal(requests, 2);
  h.controller.configure("lead", true);
  await flush();
  assert.equal(requests, 3);
  h.controller.dispose();
  assert.equal(h.scheduled(), false);
});

test("switching conversations discards old results without overlapping requests", async () => {
  const first = deferred<ConversationAgentUsage>();
  const second = deferred<ConversationAgentUsage>();
  const ids: string[] = [];
  const h = setup((id) => {
    ids.push(id);
    return id === "lead" ? first.promise : second.promise;
  });
  h.controller.configure("lead", true);
  h.controller.retry();
  h.controller.configure("child", true);
  assert.deepEqual(ids, ["lead"]);
  first.resolve(result(10));
  await flush();
  assert.equal(h.state().usage, undefined);
  assert.deepEqual(ids, ["lead", "child"]);
  second.resolve(result(2));
  await flush();
  assert.equal(h.state().usage?.subagentCount, 2);
  h.controller.dispose();
});

test("errors retain last successful totals and retry clears the stale indication", async () => {
  let fail = true;
  const h = setup(async () => {
    if (fail) throw new Error("offline");
    return result(3);
  });
  h.controller.configure("lead", true);
  await flush();
  assert.equal(h.state().usage, undefined);
  assert.match(h.state().error!, /offline/);
  fail = false;
  h.controller.retry();
  await flush();
  assert.equal(h.state().usage?.subagentCount, 3);
  assert.equal(h.state().error, undefined);
  fail = true;
  h.tick();
  await flush();
  assert.equal(h.state().usage?.subagentCount, 3);
  assert.match(h.state().error!, /offline/);
  h.controller.dispose();
});

test("disconnect invalidates in-flight results and reconnect fetches immediately", async () => {
  const pending = deferred<ConversationAgentUsage>();
  let requests = 0;
  const h = setup(() => {
    requests++;
    return requests === 1 ? pending.promise : Promise.resolve(result(4));
  });
  h.controller.configure("lead", true);
  h.controller.configure("lead", false);
  pending.resolve(result(1));
  await flush();
  assert.equal(h.state().usage, undefined);
  assert.equal(h.scheduled(), false);
  h.controller.configure("lead", true);
  await flush();
  assert.equal(requests, 2);
  assert.equal(h.state().usage?.subagentCount, 4);
  h.controller.dispose();
});

test("dispose ignores a pending response", async () => {
  const pending = deferred<ConversationAgentUsage>();
  const h = setup(() => pending.promise);
  h.controller.configure("lead", true);
  h.controller.dispose();
  pending.resolve(result(9));
  await flush();
  assert.equal(h.state().usage, undefined);
  assert.equal(h.scheduled(), false);
});
