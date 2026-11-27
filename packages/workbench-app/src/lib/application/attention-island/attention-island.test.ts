import assert from "node:assert/strict";
import { test } from "node:test";
import {
  collapseIsland,
  expandIsland,
  initialIslandState,
  islandShown,
  laterIsland,
  markerShown,
  observeConversations,
  observeTrust,
  pruneIsland,
  settleIsland,
  type IslandState,
} from "./attention-island";

function baselined(): IslandState {
  return observeConversations(
    observeTrust(initialIslandState(), "p", []),
    [],
    undefined,
  );
}

test("what already waits is quiet; a new item arrives", () => {
  let state = observeTrust(initialIslandState(), "p", ["a"]);
  assert.equal(state.phase, "compact");
  state = observeTrust(state, "p", ["a", "b"]);
  assert.equal(state.phase, "arrival");
  assert.deepEqual(state.arrival, { level: "trust", key: "b" });
  assert.equal(state.trustArrivals, 1);
  // Another project's first read is quiet too.
  const other = observeTrust(settleIsland(state), "q", ["a", "b", "c"]);
  assert.equal(other.phase, "compact");
});

test("arrivals queue trust first and never stack", () => {
  let state = baselined();
  state = observeConversations(
    state,
    [{ key: "c1", conversationId: "x" }],
    undefined,
  );
  assert.deepEqual(state.arrival, { level: "conversation", key: "c1" });
  state = observeConversations(
    state,
    [
      { key: "c1", conversationId: "x" },
      { key: "c2", conversationId: "y" },
    ],
    undefined,
  );
  state = observeTrust(state, "p", ["t1"]);
  // The conversation already showing stays; the trust item goes next.
  assert.deepEqual(state.arrival, { level: "conversation", key: "c1" });
  assert.deepEqual(
    state.queue.map((arrival) => arrival.key),
    ["t1", "c2"],
  );
  state = settleIsland(state);
  assert.deepEqual(state.arrival, { level: "trust", key: "t1" });
  state = settleIsland(settleIsland(state));
  assert.equal(state.phase, "compact");
  assert.equal(state.arrival, undefined);
});

test("both while another shows: trust goes first", () => {
  let state: IslandState = {
    ...baselined(),
    phase: "arrival",
    arrival: { level: "conversation", key: "c0" },
  };
  state = observeConversations(
    state,
    [{ key: "c1", conversationId: "x" }],
    undefined,
  );
  state = observeTrust(state, "p", ["t1"]);
  assert.deepEqual(
    state.queue.map((arrival) => arrival.level),
    ["trust", "conversation"],
  );
});

test("the open conversation never arrives, and nothing arrives twice", () => {
  let state = baselined();
  state = observeConversations(
    state,
    [{ key: "c1", conversationId: "open" }],
    "open",
  );
  assert.equal(state.phase, "compact");
  state = observeConversations(
    state,
    [{ key: "c1", conversationId: "open" }],
    undefined,
  );
  assert.equal(state.phase, "compact");
});

test("Later hides island and marker until a new trust item arrives", () => {
  let state = observeTrust(baselined(), "p", ["t1"]);
  state = laterIsland(state);
  const counts = { trust: 1, conversations: 1 };
  assert.equal(islandShown(state, counts), false);
  assert.equal(markerShown(state, 1), false);
  // A conversation does not bring it back.
  state = observeConversations(
    state,
    [{ key: "c1", conversationId: "x" }],
    undefined,
  );
  assert.equal(state.phase, "later");
  // A new trust item does, and the marker pulses again.
  const before = state.trustArrivals;
  state = observeTrust(state, "p", ["t1", "t2"]);
  assert.equal(state.phase, "arrival");
  assert.deepEqual(state.arrival, { level: "trust", key: "t2" });
  assert.equal(state.trustArrivals, before + 1);
  assert.equal(markerShown(state, 2), true);
});

test("the marker shows trust items only, the island any level", () => {
  assert.equal(markerShown(baselined(), 0), false);
  assert.equal(islandShown(baselined(), { trust: 0, conversations: 1 }), true);
  assert.equal(islandShown(baselined(), { trust: 0, conversations: 0 }), false);
});

test("a decided item leaves the line; expanding drops arrivals", () => {
  let state = observeTrust(baselined(), "p", ["t1", "t2"]);
  assert.deepEqual(state.arrival, { level: "trust", key: "t1" });
  state = pruneIsland(state, {
    trust: new Set(["t2"]),
    conversations: new Set(),
  });
  assert.deepEqual(state.arrival, { level: "trust", key: "t2" });
  state = expandIsland(state);
  assert.equal(state.arrival, undefined);
  assert.equal(state.queue.length, 0);
  // New items while the list is open show in the list, not as arrivals.
  state = observeTrust(state, "p", ["t2", "t3"]);
  assert.equal(state.phase, "expanded");
  assert.equal(collapseIsland(state).phase, "compact");
});
