import assert from "node:assert/strict";
import test from "node:test";
import type { RunRecord } from "@nervekit/contracts";
import {
  ActiveRunLookup,
  RunLookupIndex,
  type RunHydratedState,
} from "../src/index.js";

function state(input: {
  runId: string;
  scopeId?: string;
  status?: RunRecord["status"];
  revision?: number;
  interactionIds?: readonly string[];
  toolCallIds?: readonly string[];
  promptIds?: readonly string[];
  updatedAt?: string;
}): RunHydratedState {
  const interactions = (input.interactionIds ?? []).map((id, index) => ({
    id,
    toolCallId: input.toolCallIds?.[index] ?? `tc_${id}`,
    status: "pending",
    createdAt: "2026-07-12T00:00:00.000Z",
  }));
  const prompts = (input.promptIds ?? []).map((id, ordinal) => ({
    id,
    ordinal,
    status: "queued",
  }));
  return {
    run: {
      runId: input.runId,
      scopeId: input.scopeId ?? `scope_${input.runId}`,
      status: input.status ?? "running",
      revision: input.revision ?? 1,
      updatedAt: input.updatedAt ?? "2026-07-12T00:00:00.000Z",
    },
    prompts,
    interactions,
    checkpoints: [],
    transitions: [],
    deliveries: [],
  } as unknown as RunHydratedState;
}

test("indexes active runs by scope, interaction, tool call, and prompt", () => {
  const index = new RunLookupIndex();
  index.observe(
    state({
      runId: "run_a",
      scopeId: "conv:agent",
      interactionIds: ["int_1"],
      toolCallIds: ["tc_1"],
      promptIds: ["prompt_1"],
    }),
  );
  assert.deepEqual(index.activeRunIds(), ["run_a"]);
  assert.equal(index.activeRunIdForScope("conv:agent"), "run_a");
  assert.equal(index.runIdForInteraction("int_1"), "run_a");
  assert.equal(index.runIdForInteractionToolCall("tc_1"), "run_a");
  assert.equal(index.runIdForPrompt("prompt_1"), "run_a");
  assert.equal(index.activeRunIdForScope("unknown"), undefined);
});

test("re-observation replaces the run's previous keys", () => {
  const index = new RunLookupIndex();
  index.observe(
    state({
      runId: "run_a",
      scopeId: "scope_1",
      revision: 1,
      interactionIds: ["int_1"],
      promptIds: ["prompt_1"],
    }),
  );
  index.observe(
    state({
      runId: "run_a",
      scopeId: "scope_1",
      revision: 2,
      interactionIds: ["int_2"],
      promptIds: ["prompt_2"],
    }),
  );
  assert.equal(index.runIdForInteraction("int_1"), undefined);
  assert.equal(index.runIdForPrompt("prompt_1"), undefined);
  assert.equal(index.runIdForInteraction("int_2"), "run_a");
  assert.equal(index.runIdForPrompt("prompt_2"), "run_a");
  assert.equal(index.activeRunIdForScope("scope_1"), "run_a");
});

test("terminal observation evicts every key for the run", () => {
  const index = new RunLookupIndex();
  index.observe(
    state({
      runId: "run_a",
      scopeId: "scope_1",
      revision: 1,
      interactionIds: ["int_1"],
      toolCallIds: ["tc_1"],
      promptIds: ["prompt_1"],
    }),
  );
  index.observe(
    state({
      runId: "run_a",
      scopeId: "scope_1",
      revision: 2,
      status: "completed",
    }),
  );
  assert.deepEqual(index.activeRunIds(), []);
  assert.equal(index.activeRunIdForScope("scope_1"), undefined);
  assert.equal(index.runIdForInteraction("int_1"), undefined);
  assert.equal(index.runIdForInteractionToolCall("tc_1"), undefined);
  assert.equal(index.runIdForPrompt("prompt_1"), undefined);
});

test("stale re-observation cannot overwrite a newer commit", () => {
  const index = new RunLookupIndex();
  index.observe(
    state({
      runId: "run_a",
      scopeId: "scope_1",
      revision: 3,
      status: "completed",
    }),
  );
  // A slow historical hydration observes the same run at an older revision.
  index.observe(
    state({
      runId: "run_a",
      scopeId: "scope_1",
      revision: 2,
      status: "running",
      interactionIds: ["int_1"],
    }),
  );
  assert.deepEqual(index.activeRunIds(), []);
  assert.equal(index.runIdForInteraction("int_1"), undefined);
});

test("duplicate observation of the same revision is idempotent", () => {
  const index = new RunLookupIndex();
  const observation = state({
    runId: "run_a",
    scopeId: "scope_1",
    revision: 2,
    interactionIds: ["int_1"],
    promptIds: ["prompt_1"],
  });
  index.observe(observation);
  index.observe(observation);
  assert.deepEqual(index.activeRunIds(), ["run_a"]);
  assert.equal(index.activeRunIdForScope("scope_1"), "run_a");
  assert.equal(index.runIdForInteraction("int_1"), "run_a");
  assert.equal(index.runIdForPrompt("prompt_1"), "run_a");
});

test("scope key transfers to the newest active run for the scope", () => {
  const index = new RunLookupIndex();
  index.observe(
    state({
      runId: "run_a",
      scopeId: "scope_1",
      revision: 5,
      status: "completed",
    }),
  );
  index.observe(state({ runId: "run_b", scopeId: "scope_1", revision: 1 }));
  assert.equal(index.activeRunIdForScope("scope_1"), "run_b");
  // Evicting run_b's keys must not clear another run's newer claim.
  index.observe(state({ runId: "run_c", scopeId: "scope_1", revision: 1 }));
  index.observe(
    state({
      runId: "run_b",
      scopeId: "scope_1",
      revision: 2,
      status: "cancelled",
    }),
  );
  assert.equal(index.activeRunIdForScope("scope_1"), "run_c");
});

function lookupFixture(initial: RunHydratedState[]) {
  const store = new Map(initial.map((item) => [item.run.runId, item]));
  const loads: string[] = [];
  let hydrations = 0;
  const lookup: ActiveRunLookup = new ActiveRunLookup({
    load: async (runId) => {
      loads.push(runId);
      return store.get(runId);
    },
    hydrateAll: async () => {
      hydrations += 1;
      for (const item of store.values()) lookup.observe(item);
      lookup.markInitialized();
    },
  });
  return {
    lookup,
    store,
    loads,
    hydrations: () => hydrations,
  };
}

test("lazy initialization hydrates once and serves targeted reads", async () => {
  const fixture = lookupFixture([
    state({ runId: "run_old", scopeId: "scope_old", status: "completed" }),
    state({
      runId: "run_live",
      scopeId: "scope_live",
      interactionIds: ["int_live"],
      toolCallIds: ["tc_live"],
      promptIds: ["prompt_live"],
    }),
  ]);
  const [byScope, byInteraction, byToolCall, byPrompt] = await Promise.all([
    fixture.lookup.findActive("scope_live"),
    fixture.lookup.findByInteractionId("int_live"),
    fixture.lookup.findByInteractionToolCallId("tc_live"),
    fixture.lookup.findByPromptId("prompt_live"),
  ]);
  assert.equal(fixture.hydrations(), 1);
  assert.equal(byScope?.run.runId, "run_live");
  assert.equal(byInteraction?.run.runId, "run_live");
  assert.equal(byToolCall?.run.runId, "run_live");
  assert.equal(byPrompt?.run.runId, "run_live");
  // Terminal history is never loaded by targeted reads.
  assert.ok(!fixture.loads.includes("run_old"));
});

test("listActive loads only indexed active runs", async () => {
  const fixture = lookupFixture([
    state({ runId: "run_1", scopeId: "scope_1", status: "failed" }),
    state({ runId: "run_2", scopeId: "scope_2", status: "waiting" }),
    state({ runId: "run_3", scopeId: "scope_3", status: "running" }),
  ]);
  const active = await fixture.lookup.listActive();
  assert.deepEqual(active.map((item) => item.run.runId).sort(), [
    "run_2",
    "run_3",
  ]);
  assert.ok(!fixture.loads.includes("run_1"));
});

test("targeted reads self-heal entries that turned terminal", async () => {
  const fixture = lookupFixture([
    state({ runId: "run_live", scopeId: "scope_live", revision: 1 }),
  ]);
  await fixture.lookup.findActive("scope_live");
  // The run commits to terminal behind the index's back.
  fixture.store.set(
    "run_live",
    state({
      runId: "run_live",
      scopeId: "scope_live",
      revision: 2,
      status: "completed",
    }),
  );
  assert.equal(await fixture.lookup.findActive("scope_live"), undefined);
  // The stale entry was healed: no further loads are attempted.
  const loadsSoFar = fixture.loads.length;
  assert.equal(await fixture.lookup.findActive("scope_live"), undefined);
  assert.equal(fixture.loads.length, loadsSoFar);
});

test("targeted reads forget runs that vanished from authority", async () => {
  const fixture = lookupFixture([
    state({ runId: "run_live", scopeId: "scope_live" }),
  ]);
  await fixture.lookup.findActive("scope_live");
  fixture.store.delete("run_live");
  assert.equal(await fixture.lookup.findActive("scope_live"), undefined);
  assert.deepEqual(await fixture.lookup.listActive(), []);
});

test("commit observations serve reads without re-hydration", async () => {
  const fixture = lookupFixture([]);
  await fixture.lookup.listActive();
  const committed = state({
    runId: "run_new",
    scopeId: "scope_new",
    interactionIds: ["int_new"],
    promptIds: ["prompt_new"],
  });
  fixture.store.set("run_new", committed);
  fixture.lookup.observe(committed);
  assert.equal(fixture.hydrations(), 1);
  assert.equal(
    (await fixture.lookup.findByPromptId("prompt_new"))?.run.runId,
    "run_new",
  );
  assert.equal(
    (await fixture.lookup.findByInteractionId("int_new"))?.run.runId,
    "run_new",
  );
  assert.equal(fixture.hydrations(), 1);
});

test("failed initialization is retried on the next targeted read", async () => {
  let attempts = 0;
  const live = state({ runId: "run_live", scopeId: "scope_live" });
  const lookup: ActiveRunLookup = new ActiveRunLookup({
    load: async (runId) => (runId === "run_live" ? live : undefined),
    hydrateAll: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("journal unavailable");
      lookup.observe(live);
      lookup.markInitialized();
    },
  });
  await assert.rejects(lookup.findActive("scope_live"), /journal unavailable/);
  assert.equal((await lookup.findActive("scope_live"))?.run.runId, "run_live");
  assert.equal(attempts, 2);
});
