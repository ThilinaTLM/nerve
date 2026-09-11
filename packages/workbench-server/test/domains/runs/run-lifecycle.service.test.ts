import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { LifecycleWork } from "@nervekit/contracts/runs";
import { ConversationJournalRepository } from "../../../src/domains/conversations/conversation-journal.repository.js";
import { RunLifecycleService } from "../../../src/domains/runs/application/run-lifecycle.service.js";
import { CanonicalStore } from "../../../src/infrastructure/persistence/canonical-sqlite/index.js";

const now = "2026-01-01T00:00:00.000Z";

test("lifecycle service commits journal state, work, and receipt once", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-run-lifecycle-service-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const store = new CanonicalStore(join(home, "nerve.sqlite"));
  await store.initialize();
  const journal = new ConversationJournalRepository({
    paths: { home },
    canonicalStore: store,
  });
  const conversation = {
    id: "conv_test",
    projectId: "proj_test",
    title: "Before",
    mode: "coding" as const,
    permissionLevel: "supervised" as const,
    createdAt: now,
    updatedAt: now,
  };
  await journal.commit(conversation.id, {
    kind: "conversation.created",
    events: [
      {
        kind: "conversation.upserted",
        conversationId: conversation.id,
        conversation,
      },
    ],
  });
  let wakes = 0;
  const service = new RunLifecycleService({
    journal,
    receipts: store,
    wakeWork: () => {
      wakes += 1;
    },
  });
  const work: LifecycleWork = {
    id: "work_test",
    deduplicationKey: "conv_test:continue",
    conversationId: conversation.id,
    kind: "continue_model",
    state: "ready",
    inputHash: `sha256:${"a".repeat(64)}`,
    generation: 0,
    attemptCount: 0,
    notBefore: now,
    createdAt: now,
    updatedAt: now,
  };
  const command = {
    conversationId: conversation.id,
    requestId: "request_test",
    inputHash: `sha256:${"b".repeat(64)}`,
    kind: "run.continuation_scheduled",
    events: [
      {
        kind: "conversation.upserted" as const,
        conversationId: conversation.id,
        conversation: { ...conversation, title: "After" },
      },
    ],
    work: [work],
    outcome: { scheduled: work.id },
  };

  const committed = await service.commit(command);
  const replayed = await service.commit(command);
  assert.equal(committed.replayed, false);
  assert.equal(replayed.replayed, true);
  assert.deepEqual(replayed.outcome, command.outcome);
  assert.equal(
    (await journal.loadFresh(conversation.id)).conversation?.title,
    "After",
  );
  assert.equal((await store.readLifecycleWork(work.id))?.state, "ready");
  assert.equal(wakes, 1);
  await assert.rejects(
    service.commit({
      ...command,
      inputHash: `sha256:${"c".repeat(64)}`,
    }),
    /Conflicting lifecycle request id/,
  );
  await journal.close();
  await store.close();
});

test("post-commit wake failure does not roll back a lifecycle decision", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-run-lifecycle-wake-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const store = new CanonicalStore(join(home, "nerve.sqlite"));
  await store.initialize();
  const journal = new ConversationJournalRepository({
    paths: { home },
    canonicalStore: store,
  });
  const conversation = {
    id: "conv_wake",
    projectId: "proj_test",
    title: "Wake",
    mode: "coding" as const,
    permissionLevel: "supervised" as const,
    createdAt: now,
    updatedAt: now,
  };
  let wakeError: unknown;
  const service = new RunLifecycleService({
    journal,
    receipts: store,
    wakeWork: () => {
      throw new Error("wakeup unavailable");
    },
    onWakeError: (error) => {
      wakeError = error;
    },
  });
  await service.commit({
    conversationId: conversation.id,
    requestId: "request_wake",
    inputHash: `sha256:${"d".repeat(64)}`,
    kind: "run.started",
    events: [
      {
        kind: "conversation.upserted",
        conversationId: conversation.id,
        conversation,
      },
    ],
    work: [],
    outcome: { started: true },
  });
  assert.match(String(wakeError), /wakeup unavailable/);
  assert.equal(await store.readConversationRevision(conversation.id), 1);
  await journal.close();
  await store.close();
});
