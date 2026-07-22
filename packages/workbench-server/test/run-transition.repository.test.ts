import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type {
  RunEventDeliveryRecord,
  RunPromptRecord,
  RunRecord,
} from "@nervekit/contracts";
import {
  buildTransition,
  RunRevisionConflictError,
} from "@nervekit/host-runtime";
import { WorkbenchRunUnitOfWork } from "../src/domains/runs/run-transition.repository.js";

const digest = `sha256:${"0".repeat(64)}`;
const runId = "run_cache_test";
const startedAt = "2026-07-12T00:00:00.000Z";

function run(revision: number, updatedAt: string): RunRecord {
  return {
    stateEpoch: 1,
    conversationId: "conv_cache_test",
    agentId: "agent_cache_test",
    projectId: "proj_cache_test",
    runId,
    scopeId: "conv_cache_test:agent_cache_test",
    revision,
    status: "running",
    recoverability: "retryable",
    executionId: "exec_cache_test",
    attempt: 1,
    createdAt: startedAt,
    updatedAt,
    startedAt,
    cancellationEvidence: [],
  };
}

function prompt(status: "queued" | "delivered"): RunPromptRecord {
  return {
    id: "promptq_cache_test",
    agentId: "agent_cache_test",
    conversationId: "conv_cache_test",
    projectId: "proj_cache_test",
    runId,
    behavior: "steer",
    text: "inspect the repository",
    status,
    createdAt: startedAt,
    updatedAt: status === "queued" ? startedAt : "2026-07-12T00:00:01.000Z",
    ordinal: 0,
    deliveryAttempts: status === "queued" ? 0 : 1,
  };
}

function transitions() {
  let id = 0;
  const ids = { next: () => String(++id) };
  const integrity = { checksum: () => digest };
  const first = buildTransition(
    run(1, startedAt),
    "started",
    0,
    {
      prompts: [prompt("queued")],
      events: [
        {
          id: "intent_cache_test",
          type: "run.started",
          delivery: "sequenced",
          occurredAt: startedAt,
          data: {},
        },
      ],
    },
    ids,
    integrity,
  );
  const second = buildTransition(
    run(2, "2026-07-12T00:00:01.000Z"),
    "prompt_delivered",
    1,
    { prompts: [prompt("delivered")] },
    ids,
    integrity,
  );
  const third = buildTransition(
    run(3, "2026-07-12T00:00:02.000Z"),
    "updated",
    2,
    {},
    ids,
    integrity,
  );
  return { first, second, third };
}

test("workbench run journals reuse hot state and cold-hydrate equivalently", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-workbench-run-store-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const unitOfWork = new WorkbenchRunUnitOfWork(home);
  const records = transitions();

  const firstState = await unitOfWork.commit(0, records.first);
  const secondState = await unitOfWork.commit(1, records.second);

  assert.equal(firstState.run.revision, 1);
  assert.equal(secondState.run.revision, 2);
  assert.equal(secondState.prompts[0]?.status, "delivered");
  assert.equal(await unitOfWork.load(runId), secondState);

  await unitOfWork.materialize(secondState);
  const root = join(home, "run-runtime", "runs", runId);
  const projectionFiles = [
    ["state.json", secondState.run],
    ["prompts.json", secondState.prompts],
    ["interactions.json", secondState.interactions],
    ["checkpoints.json", secondState.checkpoints],
  ] as const;
  for (const [name, expected] of projectionFiles) {
    const raw = await readFile(join(root, name), "utf8");
    assert.equal(raw.endsWith("\n"), true);
    assert.deepEqual(JSON.parse(raw), expected);
  }

  const delivery: RunEventDeliveryRecord = {
    intentId: "intent_cache_test",
    runId,
    revision: 1,
    eventId: "event_cache_test",
    sequence: 7,
    deliveredAt: "2026-07-12T00:00:03.000Z",
  };
  await unitOfWork.markEventDelivered(delivery);
  await unitOfWork.markEventDelivered(delivery);
  const hot = await unitOfWork.load(runId);
  assert.deepEqual(hot?.deliveries, [delivery]);

  const fresh = new WorkbenchRunUnitOfWork(home);
  assert.deepEqual(await fresh.load(runId), hot);
  const deliveriesPath = join(root, "event-deliveries.jsonl");
  assert.equal(
    (await readFile(deliveriesPath, "utf8")).trim().split("\n").length,
    1,
  );

  const retriedDelivery = {
    ...delivery,
    deliveredAt: "2026-07-12T00:00:03.001Z",
  };
  await appendFile(deliveriesPath, `${JSON.stringify(retriedDelivery)}\n`);
  const restarted = new WorkbenchRunUnitOfWork(home);
  assert.deepEqual((await restarted.load(runId))?.deliveries, [delivery]);

  await assert.rejects(
    unitOfWork.commit(1, records.third),
    RunRevisionConflictError,
  );
  await assert.rejects(
    unitOfWork.markEventDelivered({
      ...delivery,
      eventId: "event_conflict",
    }),
    /Conflicting event delivery/,
  );
});

test("fresh loads replace stale cached run state from the journal", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-workbench-run-fresh-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const cached = new WorkbenchRunUnitOfWork(home);
  const writer = new WorkbenchRunUnitOfWork(home);
  const records = transitions();

  const first = await cached.commit(0, records.first);
  await writer.commit(1, records.second);

  assert.equal((await cached.load(runId))?.run.revision, first.run.revision);
  const fresh = await cached.loadFresh(runId);
  assert.equal(fresh?.run.revision, 2);
  assert.equal(fresh?.prompts[0]?.status, "delivered");
  assert.equal(await cached.load(runId), fresh);
});

function scopedRun(input: {
  runId: string;
  scopeId: string;
  revision: number;
  status: RunRecord["status"];
  activeInteractionId?: string;
}): RunRecord {
  return {
    stateEpoch: 1,
    conversationId: "conv_lookup_test",
    agentId: "agent_lookup_test",
    projectId: "proj_lookup_test",
    runId: input.runId,
    scopeId: input.scopeId,
    revision: input.revision,
    status: input.status,
    recoverability: "retryable",
    executionId: "exec_lookup_test",
    attempt: 1,
    createdAt: startedAt,
    updatedAt: startedAt,
    startedAt,
    activeInteractionId: input.activeInteractionId,
    terminalAt: ["completed", "failed", "cancelled"].includes(input.status)
      ? startedAt
      : undefined,
    cancellationEvidence: [],
  };
}

test("targeted lookups skip historical hydration and evict terminal commits", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-workbench-run-lookup-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  let id = 1000;
  const ids = { next: () => String(++id) };
  const integrity = { checksum: () => digest };
  // Cache size zero forces every load through authoritative journal reads.
  const seed = new WorkbenchRunUnitOfWork(home, 0);

  const historicalRunIds: string[] = [];
  for (let index = 0; index < 8; index += 1) {
    const historicalRunId = `run_history_${index}`;
    historicalRunIds.push(historicalRunId);
    const scopeId = `conv_lookup_test:agent_history_${index}`;
    await seed.commit(
      0,
      buildTransition(
        scopedRun({
          runId: historicalRunId,
          scopeId,
          revision: 1,
          status: "running",
        }),
        "started",
        0,
        {},
        ids,
        integrity,
      ),
    );
    await seed.commit(
      1,
      buildTransition(
        scopedRun({
          runId: historicalRunId,
          scopeId,
          revision: 2,
          status: "completed",
        }),
        "completed",
        1,
        {},
        ids,
        integrity,
      ),
    );
  }

  const liveRunId = "run_live";
  const liveScopeId = "conv_lookup_test:agent_live";
  const liveInteraction = {
    stateEpoch: 1,
    kind: "question",
    id: "interaction_live",
    conversationId: "conv_lookup_test",
    agentId: "agent_lookup_test",
    projectId: "proj_lookup_test",
    runId: liveRunId,
    executionId: "exec_lookup_test",
    toolCallId: "toolcall_live",
    prompt: "Which option should be used?",
    status: "pending",
    required: true,
    checkpointId: "checkpoint_live",
    createdAt: startedAt,
  } as const;
  const livePrompt: RunPromptRecord = {
    id: "promptq_live",
    agentId: "agent_lookup_test",
    conversationId: "conv_lookup_test",
    projectId: "proj_lookup_test",
    runId: liveRunId,
    behavior: "steer",
    text: "queued while waiting",
    status: "queued",
    createdAt: startedAt,
    updatedAt: startedAt,
    ordinal: 0,
    deliveryAttempts: 0,
  };
  await seed.commit(
    0,
    buildTransition(
      scopedRun({
        runId: liveRunId,
        scopeId: liveScopeId,
        revision: 1,
        status: "waiting",
        activeInteractionId: liveInteraction.id,
      }),
      "waiting",
      0,
      { interactions: [liveInteraction], prompts: [livePrompt] },
      ids,
      integrity,
    ),
  );

  // A restarted store initializes its lookup lazily from one full hydration.
  const restarted = new WorkbenchRunUnitOfWork(home, 0);
  const active = await restarted.findActive(liveScopeId);
  assert.equal(active?.run.runId, liveRunId);

  // Corrupt every historical journal: any further hydration of terminal
  // history now throws, so passing targeted reads proves they only load the
  // indexed active run.
  for (const historicalRunId of historicalRunIds) {
    await appendFile(
      join(home, "run-runtime", "runs", historicalRunId, "transitions.jsonl"),
      "not-json\n",
    );
  }
  await assert.rejects(restarted.list(), /Corrupt run journal/);

  assert.equal((await restarted.findActive(liveScopeId))?.run.runId, liveRunId);
  assert.deepEqual(
    (await restarted.listActive()).map((state) => state.run.runId),
    [liveRunId],
  );
  assert.equal(
    (await restarted.findByInteractionId("interaction_live"))?.run.runId,
    liveRunId,
  );
  assert.equal(
    (await restarted.findByInteractionToolCallId("toolcall_live"))?.run.runId,
    liveRunId,
  );
  assert.equal(
    (await restarted.findByPromptId("promptq_live"))?.run.runId,
    liveRunId,
  );

  // Committing the run to a terminal status evicts every targeted key.
  await restarted.commit(
    1,
    buildTransition(
      scopedRun({
        runId: liveRunId,
        scopeId: liveScopeId,
        revision: 2,
        status: "cancelled",
      }),
      "cancelled",
      1,
      {},
      ids,
      integrity,
    ),
  );
  assert.equal(await restarted.findActive(liveScopeId), undefined);
  assert.deepEqual(await restarted.listActive(), []);
  assert.equal(await restarted.findByPromptId("promptq_live"), undefined);
  assert.equal(
    await restarted.findByInteractionToolCallId("toolcall_live"),
    undefined,
  );
});
