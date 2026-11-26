import assert from "node:assert/strict";
import test from "node:test";
import type {
  ConfigurationReview,
  ConfigurationReviewTarget,
} from "@nervekit/contracts/configuration";
import {
  ConfigurationReviewQueue,
  emptyReviewQueueFields,
  STALE_REVIEW_NOTICE,
  type ConfigurationReviewApi,
} from "./review-queue";

const target = (id: string): ConfigurationReviewTarget => ({
  kind: "agent-profile",
  scope: "user",
  id,
});

function review(
  item: ConfigurationReviewTarget,
  digest = "sha256:a",
): ConfigurationReview {
  return {
    target: item,
    name: item.id,
    kindLabel: "Sub-agent profile",
    state: "needs_review",
    changedSinceDecision: false,
    items: [],
    sources: [],
    digest,
  };
}

/** A fake daemon: digests per item, decisions recorded, one refusal on demand. */
function fakeApi(digests: Record<string, string> = {}) {
  const decided: { id: string; digest: string; trusted: boolean }[] = [];
  let refuse = false;
  const api: ConfigurationReviewApi = {
    review: async (item) => review(item, digests[item.id]),
    decide: async ({ target: item, digest, trusted }) => {
      if (refuse) throw new Error("The item changed.");
      decided.push({ id: item.id, digest, trusted });
      return {
        ...review(item, digest),
        state: trusted ? "trusted" : "declined",
      };
    },
  };
  return {
    api,
    decided,
    refuseNext: () => (refuse = true),
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("the queue keeps the given order, drops duplicates and starts where asked", async () => {
  const { api } = fakeApi();
  const queue = new ConfigurationReviewQueue(emptyReviewQueueFields(), api);
  queue.start([target("a"), target("b"), target("a"), target("c")], 1);
  await settle();
  assert.deepEqual(
    queue.targets.map((item) => item.id),
    ["a", "b", "c"],
  );
  assert.equal(queue.current?.id, "b");
  assert.equal(queue.review?.name, "b");
  queue.previous();
  await settle();
  assert.equal(queue.review?.name, "a");
});

test("Not now moves on without deciding and closes after the last item", async () => {
  const { api, decided } = fakeApi();
  const queue = new ConfigurationReviewQueue(emptyReviewQueueFields(), api);
  queue.start([target("a"), target("b")]);
  await settle();
  queue.skip();
  await settle();
  assert.equal(queue.current?.id, "b");
  queue.skip();
  assert.equal(queue.open, false);
  assert.deepEqual(decided, []);
});

test("a decision covers the digest shown, tells the pages and moves on", async () => {
  const { api, decided } = fakeApi({ a: "sha256:a1", b: "sha256:b1" });
  let refreshed = 0;
  const queue = new ConfigurationReviewQueue(
    emptyReviewQueueFields(),
    api,
    () => void refreshed++,
  );
  const told: string[] = [];
  queue.onDecision((decision) =>
    told.push(`${decision.target.id}:${decision.state}`),
  );
  queue.start([target("a"), target("b")]);
  await settle();
  await queue.trust();
  await settle();
  assert.deepEqual(decided, [{ id: "a", digest: "sha256:a1", trusted: true }]);
  assert.deepEqual(told, ["a:trusted"]);
  assert.equal(refreshed, 1);
  assert.equal(queue.current?.id, "b");
  await queue.decline();
  assert.deepEqual(decided.at(-1), {
    id: "b",
    digest: "sha256:b1",
    trusted: false,
  });
  assert.equal(queue.open, false);
});

test("a stale digest shows the new review with a notice instead of deciding", async () => {
  const digests = { a: "sha256:old" };
  const { api, decided, refuseNext } = fakeApi(digests);
  const queue = new ConfigurationReviewQueue(emptyReviewQueueFields(), api);
  queue.start([target("a")]);
  await settle();
  digests.a = "sha256:new";
  refuseNext();
  await queue.trust();
  assert.equal(queue.open, true);
  assert.equal(queue.notice, STALE_REVIEW_NOTICE);
  assert.equal(queue.review?.digest, "sha256:new");
  assert.equal(queue.busy, false);
  assert.deepEqual(decided, []);
});

test("a refusal with unchanged content shows the daemon's error", async () => {
  const { api, refuseNext } = fakeApi({ a: "sha256:same" });
  const queue = new ConfigurationReviewQueue(emptyReviewQueueFields(), api);
  queue.start([target("a")]);
  await settle();
  refuseNext();
  await queue.trust();
  assert.equal(queue.notice, undefined);
  assert.equal(queue.error, "The item changed.");
});

test("a failed read shows the error and Retry reads again", async () => {
  let fail = true;
  const queue = new ConfigurationReviewQueue(emptyReviewQueueFields(), {
    review: async (item) => {
      if (fail) throw new Error("offline");
      return review(item);
    },
    decide: async () => {
      throw new Error("unused");
    },
  });
  queue.start([target("a"), target("b")]);
  await settle();
  assert.equal(queue.phase, "error");
  assert.equal(queue.error, "offline");
  fail = false;
  await queue.reload();
  assert.equal(queue.phase, "ready");
  assert.equal(queue.review?.name, "a");
});

test("a decision from another window refreshes here; the echo of one made here does not twice", async () => {
  const { api } = fakeApi();
  let refreshed = 0;
  const queue = new ConfigurationReviewQueue(
    emptyReviewQueueFields(),
    api,
    () => void refreshed++,
  );
  const told: string[] = [];
  queue.onDecision((decided) =>
    told.push(`${decided.target.id}:${decided.state}`),
  );
  queue.start([target("a")]);
  await settle();
  await queue.trust();
  // The daemon's `configuration.decided` for the decision made here.
  queue.received({ target: target("a"), state: "trusted" });
  // A decision made on the phone.
  queue.received({ target: target("b"), state: "declined" });
  assert.deepEqual(told, ["a:trusted", "b:declined"]);
  assert.equal(refreshed, 2);
});
