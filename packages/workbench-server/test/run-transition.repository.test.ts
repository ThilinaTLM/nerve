import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type {
  ConversationEntry,
  RunEventDeliveryRecord,
  RunPromptRecord,
  RunRecord,
} from "@nervekit/contracts";
import {
  buildTransition,
  RunRevisionConflictError,
} from "../src/domains/runs/runtime/index.js";
import { WorkbenchRunUnitOfWork } from "../src/domains/runs/run-transition.repository.js";

const digest = `sha256:${"0".repeat(64)}`;
const runId = "run_cache_test";
const conversationId = "conv_cache_test";
const startedAt = "2026-07-12T00:00:00.000Z";

function run(revision: number, updatedAt: string): RunRecord {
  return {
    stateEpoch: 1,
    conversationId,
    agentId: "agent_cache_test",
    projectId: "proj_cache_test",
    runId,
    scopeId: `${conversationId}:agent_cache_test`,
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
    conversationId,
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

function transcriptEntry(): ConversationEntry {
  return {
    id: "entry_cache_test",
    conversationId,
    agentId: "agent_cache_test",
    runId,
    role: "user",
    kind: "message",
    text: "inspect the repository",
    createdAt: startedAt,
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
      entries: [transcriptEntry()],
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
  return { first, second };
}

test("run state and deliveries replay from the conversation journal", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-conversation-run-store-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const unitOfWork = new WorkbenchRunUnitOfWork(home);
  const records = transitions();

  await unitOfWork.commit(0, records.first);
  const second = await unitOfWork.commit(1, records.second);
  assert.equal(second.prompts[0]?.status, "delivered");

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

  const restarted = new WorkbenchRunUnitOfWork(home);
  const replayed = await restarted.load(runId);
  assert.equal(replayed?.run.revision, 2);
  assert.deepEqual(replayed?.deliveries, [delivery]);
  assert.deepEqual(
    replayed?.transitions.flatMap((transition) => transition.entries),
    [transcriptEntry()],
    "event settlement must not discard transcript evidence needed by checkpoints",
  );

  const journal = await readFile(
    join(home, "conversations", conversationId, "journal.jsonl"),
    "utf8",
  );
  assert.equal(journal.trim().split("\n").length, 3);
});

test("run commits preserve per-run compare-and-swap", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-conversation-run-cas-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const unitOfWork = new WorkbenchRunUnitOfWork(home);
  const records = transitions();
  await unitOfWork.commit(0, records.first);
  await assert.rejects(
    unitOfWork.commit(0, records.second),
    RunRevisionConflictError,
  );
});

test("active run lookup is rebuilt from conversation journals", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-conversation-run-lookup-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const records = transitions();
  await new WorkbenchRunUnitOfWork(home).commit(0, records.first);

  const restarted = new WorkbenchRunUnitOfWork(home, 0);
  const active = await restarted.findActive(
    `${conversationId}:agent_cache_test`,
  );
  assert.equal(active?.run.runId, runId);
  assert.deepEqual(await restarted.listMetadata(), [records.first.run]);
});
