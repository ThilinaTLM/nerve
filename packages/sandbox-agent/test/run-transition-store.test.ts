import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
import { SandboxRunUnitOfWork } from "../src/agent/run-transition-store.js";

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
          durability: "durable",
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

test("sandbox run journals reuse hot state and cold-hydrate equivalently", async (t) => {
  const stateDir = await mkdtemp(
    path.join(os.tmpdir(), "nerve-sandbox-run-store-"),
  );
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  const unitOfWork = new SandboxRunUnitOfWork(stateDir);
  const records = transitions();

  const firstState = await unitOfWork.commit(0, records.first);
  const secondState = await unitOfWork.commit(1, records.second);

  assert.equal(firstState.run.revision, 1);
  assert.equal(secondState.run.revision, 2);
  assert.equal(secondState.prompts[0]?.status, "delivered");
  assert.equal(await unitOfWork.load(runId), secondState);

  await unitOfWork.materialize(secondState);
  const root = path.join(stateDir, "run-runtime", "runs", runId);
  const projectionFiles = [
    ["state.json", secondState.run],
    ["prompts.json", secondState.prompts],
    ["interactions.json", secondState.interactions],
    ["checkpoints.json", secondState.checkpoints],
  ] as const;
  for (const [name, expected] of projectionFiles) {
    const raw = await readFile(path.join(root, name), "utf8");
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

  const fresh = new SandboxRunUnitOfWork(stateDir);
  assert.deepEqual(await fresh.load(runId), hot);
  const deliveriesPath = path.join(root, "event-deliveries.jsonl");
  assert.equal(
    (await readFile(deliveriesPath, "utf8")).trim().split("\n").length,
    1,
  );

  const retriedDelivery = {
    ...delivery,
    deliveredAt: "2026-07-12T00:00:03.001Z",
  };
  await appendFile(deliveriesPath, `${JSON.stringify(retriedDelivery)}\n`);
  const restarted = new SandboxRunUnitOfWork(stateDir);
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
