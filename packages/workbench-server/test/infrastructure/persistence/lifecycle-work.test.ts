import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { LifecycleWork } from "@nervekit/contracts/runs";
import { CanonicalStore } from "../../../src/infrastructure/persistence/canonical-sqlite/index.js";

const now = "2026-01-01T00:00:00.000Z";
const work: LifecycleWork = {
  id: "work_test",
  deduplicationKey: "run_test:execute:proposal_test",
  conversationId: "conv_test",
  runId: "run_test",
  proposalId: "proposal_test",
  kind: "execute_tool",
  state: "ready",
  inputHash: `sha256:${"a".repeat(64)}`,
  generation: 0,
  attemptCount: 0,
  notBefore: now,
  createdAt: now,
  updatedAt: now,
};

test("lifecycle work uses fenced claims and terminal settlement", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-lifecycle-work-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const store = new CanonicalStore(join(home, "nerve.sqlite"));
  await store.initialize();

  assert.deepEqual(await store.insertLifecycleWork(work), work);
  assert.deepEqual(await store.insertLifecycleWork(work), work);
  assert.deepEqual(
    (await store.listDueLifecycleWork(now)).map((item) => item.id),
    [work.id],
  );

  const claimed = await store.claimLifecycleWork({
    workId: work.id,
    expectedGeneration: 0,
    leaseOwner: "boot_one",
    leaseDeadline: "2026-01-01T00:00:30.000Z",
    now,
  });
  assert.equal(claimed?.state, "leased");
  assert.equal(claimed?.generation, 1);
  assert.equal(claimed?.attemptCount, 1);
  const renewed = await store.renewLifecycleWork({
    workId: work.id,
    expectedGeneration: 1,
    leaseOwner: "boot_one",
    leaseDeadline: "2026-01-01T00:00:40.000Z",
    now: "2026-01-01T00:00:10.000Z",
  });
  assert.equal(renewed?.leaseDeadline, "2026-01-01T00:00:40.000Z");
  assert.equal(
    await store.claimLifecycleWork({
      workId: work.id,
      expectedGeneration: 0,
      leaseOwner: "boot_two",
      leaseDeadline: "2026-01-01T00:00:30.000Z",
      now,
    }),
    undefined,
  );

  assert.equal(
    await store.settleLifecycleWork({
      workId: work.id,
      expectedGeneration: 1,
      leaseOwner: "wrong_owner",
      state: "succeeded",
      now,
    }),
    undefined,
  );
  const settled = await store.settleLifecycleWork({
    workId: work.id,
    expectedGeneration: 1,
    leaseOwner: "boot_one",
    state: "succeeded",
    now,
  });
  assert.equal(settled?.state, "succeeded");
  assert.equal((await store.readLifecycleWork(work.id))?.leaseOwner, undefined);
  await store.close();
});

test("conversation delta, successor work, and command receipt commit atomically", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-lifecycle-atomic-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const store = new CanonicalStore(join(home, "nerve.sqlite"));
  await store.initialize();
  const conversation = {
    id: "conv_atomic",
    projectId: "proj_test",
    title: "Atomic lifecycle",
    mode: "coding" as const,
    permissionLevel: "supervised" as const,
    createdAt: now,
    updatedAt: now,
  };
  const input = {
    delta: {
      conversationId: conversation.id,
      previousRevision: 0,
      commit: {
        epoch: 1 as const,
        conversationId: conversation.id,
        commitId: "commit_atomic",
        revision: 1,
        previousRevision: 0,
        kind: "run.lifecycle_test",
        committedAt: now,
        events: [
          {
            kind: "conversation.upserted" as const,
            conversationId: conversation.id,
            conversation,
          },
        ],
        checksum: `sha256:${"b".repeat(64)}`,
      },
      conversation,
      records: [],
      leaves: [],
    },
    work: [{ ...work, id: "work_atomic", conversationId: conversation.id }],
    receipt: {
      scopeId: conversation.id,
      requestId: "request_atomic",
      inputHash: `sha256:${"d".repeat(64)}`,
      outcome: { accepted: true },
      createdAt: now,
    },
  };

  const first = await store.persistLifecycleAtomicCommit(input);
  assert.deepEqual(first, { replayed: false, outcome: { accepted: true } });
  assert.equal(await store.readConversationRevision(conversation.id), 1);
  assert.equal((await store.readLifecycleWork("work_atomic"))?.state, "ready");
  assert.deepEqual(await store.persistLifecycleAtomicCommit(input), {
    replayed: true,
    outcome: { accepted: true },
  });
  await store.close();
});

test("failed successor insertion rolls back its conversation commit and receipt", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-lifecycle-rollback-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const store = new CanonicalStore(join(home, "nerve.sqlite"));
  await store.initialize();
  await store.insertLifecycleWork(work);
  const conversation = {
    id: "conv_rollback",
    projectId: "proj_test",
    title: "Rollback lifecycle",
    mode: "coding" as const,
    permissionLevel: "supervised" as const,
    createdAt: now,
    updatedAt: now,
  };
  const input = {
    delta: {
      conversationId: conversation.id,
      previousRevision: 0,
      commit: {
        epoch: 1 as const,
        conversationId: conversation.id,
        commitId: "commit_rollback",
        revision: 1,
        previousRevision: 0,
        kind: "run.lifecycle_test",
        committedAt: now,
        events: [
          {
            kind: "conversation.upserted" as const,
            conversationId: conversation.id,
            conversation,
          },
        ],
        checksum: `sha256:${"e".repeat(64)}`,
      },
      conversation,
      records: [],
      leaves: [],
    },
    aggregate: {
      run: {
        runId: "run_rollback",
        conversationId: conversation.id,
        projectId: "proj_test",
        agentId: "agent_test",
        branchEpoch: 1,
        revision: 1,
        state: "open" as const,
        createdAt: now,
        updatedAt: now,
      },
      proposals: [],
      interactions: [
        {
          id: "interaction_missing_proposal",
          proposalId: "proposal_missing",
          runId: "run_rollback",
          kind: "approval" as const,
          status: "pending" as const,
          request: {},
          requestedAt: now,
        },
      ],
      attempts: [],
      recoveryIssues: [],
    },
    work: [{ ...work, id: "work_conflict", conversationId: conversation.id }],
    receipt: {
      scopeId: conversation.id,
      requestId: "request_rollback",
      inputHash: `sha256:${"f".repeat(64)}`,
      outcome: { accepted: true },
      createdAt: now,
    },
  };
  await assert.rejects(
    store.persistLifecycleAtomicCommit(input),
    /FOREIGN KEY|UNIQUE/,
  );
  assert.equal(await store.readConversationRevision(conversation.id), 0);
  await store.close();
});

test("reconciliation operation results are durable and request-scoped", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-reconciliation-operation-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const store = new CanonicalStore(join(home, "nerve.sqlite"));
  await store.initialize();
  const running = {
    id: "reconcile_test",
    conversationId: "conv_test",
    requestId: "request_test",
    status: "running" as const,
    createdAt: now,
    updatedAt: now,
  };

  assert.deepEqual(await store.beginReconciliationOperation(running), running);
  assert.deepEqual(
    await store.beginReconciliationOperation({
      ...running,
      id: "reconcile_conflict",
    }),
    running,
  );
  const completed = {
    ...running,
    status: "completed" as const,
    result: { changed: true },
  };
  await store.settleReconciliationOperation(completed);
  assert.deepEqual(
    await store.readReconciliationOperation("conv_test", "request_test"),
    completed,
  );
  await store.close();
});

test("expired leases are listed but never implicitly reclaimed", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-lifecycle-expiry-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const store = new CanonicalStore(join(home, "nerve.sqlite"));
  await store.initialize();
  await store.insertLifecycleWork(work);
  await store.claimLifecycleWork({
    workId: work.id,
    expectedGeneration: 0,
    leaseOwner: "old_boot",
    leaseDeadline: "2026-01-01T00:00:10.000Z",
    now,
  });

  const expired = await store.listExpiredLifecycleWork(
    "2026-01-01T00:01:00.000Z",
  );
  assert.equal(expired[0]?.id, work.id);
  assert.equal(expired[0]?.state, "leased");
  await store.close();
});
