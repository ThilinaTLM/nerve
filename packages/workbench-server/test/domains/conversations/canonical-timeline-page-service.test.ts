import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CanonicalTimelineIdentityService } from "../../../src/domains/conversations/timeline/canonical-timeline-identity.service.js";
import { CanonicalTranscriptProjectionService } from "../../../src/domains/conversations/timeline/canonical-transcript-projection.service.js";
import { CanonicalTimelinePageProvider } from "../../../src/domains/conversations/timeline/canonical-timeline-page-provider.js";
import { buildAppendTransition } from "../../../src/domains/conversations/timeline/transition-builders.js";
import { CanonicalStore } from "../../../src/infrastructure/persistence/canonical-sqlite/canonical-store.js";

const hash = `sha256:${"c".repeat(64)}`;

test("INV-PAGE-01 INV-VIEW-01 pages fixed projection snapshots", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-canonical-page-"));
  const store = new CanonicalStore(join(home, "nerve.sqlite"));
  await store.initialize();
  t.after(async () => {
    await store.close();
    await rm(home, { recursive: true, force: true });
  });
  const identity = await new CanonicalTimelineIdentityService(store).resolve();
  const emptyHead = {
    schemaVersion: 1 as const,
    conversationId: "conv_page",
    revision: 0,
    activeEntryId: null,
    selectionEpoch: 0,
    foregroundRunId: null,
  };
  const initial = buildAppendTransition({
    head: emptyHead,
    identity: {
      commandId: "page-seed",
      inputFingerprint: hash,
      actor: { kind: "test" },
      cause: { kind: "seed" },
      committedAt: "2026-09-12T00:00:00.000Z",
    },
    entries: [1, 2, 3, 4, 5].map((number) => ({
      entryId: `entry_${number}`,
      kind: "user_message" as const,
      inlineContent: { number },
    })),
  });
  await store.commitConversationCommand({
    namespaceId: identity.namespaceId,
    executionIncarnationId: identity.executionIncarnationId,
    operationKind: "seed",
    ownerKind: "conversation",
    ownerId: "conv_page",
    commandId: "page-seed",
    fingerprintVersion: 1,
    fingerprint: hash,
    expectedHeads: [
      {
        conversationId: "conv_page",
        revision: 0,
        selectionEpoch: 0,
        createIfMissing: true,
      },
    ],
    transitions: [initial],
    outcome: {},
    publicationIntents: [],
    now: "2026-09-12T00:00:00.000Z",
  });
  const secretValues = new Map<string, string>();
  const secrets = {
    get: (name: string) => Promise.resolve(secretValues.get(name)),
    set: (name: string, value: string) => {
      secretValues.set(name, value);
      return Promise.resolve();
    },
    delete: (name: string) => {
      secretValues.delete(name);
      return Promise.resolve();
    },
    list: () => Promise.resolve([...secretValues.keys()]),
  };
  const projections = new CanonicalTranscriptProjectionService(store);
  const [rebuilt] = await projections.rebuildPending(
    10,
    "2026-09-12T00:00:01.000Z",
  );
  assert.equal(rebuilt?.appliedRevision, 1);
  assert.equal(rebuilt?.rebuildGeneration, 1);

  const pages = new CanonicalTimelinePageProvider(store, secrets);
  const first = await pages.page({ conversationId: "conv_page", pageSize: 2 });
  assert.equal(first.kind, "page");
  assert.deepEqual(
    first.kind === "page"
      ? first.page.entries.map((entry) => entry.entryId)
      : [],
    ["entry_1", "entry_2"],
  );
  const cursor = first.kind === "page" ? first.page.nextCursor : undefined;
  assert.ok(cursor);

  const advanced = buildAppendTransition({
    head: initial.resultingHead,
    identity: {
      commandId: "page-advance",
      inputFingerprint: hash,
      actor: { kind: "test" },
      cause: { kind: "advance" },
      committedAt: "2026-09-12T00:00:01.000Z",
    },
    entries: [{ entryId: "entry_6", kind: "user_message", inlineContent: 6 }],
  });
  await store.commitConversationCommand({
    namespaceId: identity.namespaceId,
    executionIncarnationId: identity.executionIncarnationId,
    operationKind: "advance",
    ownerKind: "conversation",
    ownerId: "conv_page",
    commandId: "page-advance",
    fingerprintVersion: 1,
    fingerprint: hash,
    expectedHeads: [
      { conversationId: "conv_page", revision: 1, selectionEpoch: 0 },
    ],
    transitions: [advanced],
    outcome: {},
    publicationIntents: [],
    now: "2026-09-12T00:00:01.000Z",
  });
  const reopenedPages = new CanonicalTimelinePageProvider(store, secrets);
  const lagging = await projections.status("conv_page");
  assert.equal(lagging?.appliedRevision, 1);
  assert.equal(lagging?.canonicalRevision, 2);
  assert.equal(lagging?.oldestPendingAt, "2026-09-12T00:00:01.000Z");

  const second = await reopenedPages.page({
    conversationId: "conv_page",
    pageSize: 2,
    cursor,
  });
  assert.equal(second.kind, "page");
  assert.deepEqual(
    second.kind === "page"
      ? second.page.entries.map((entry) => entry.entryId)
      : [],
    ["entry_3", "entry_4"],
  );
  assert.equal(second.kind === "page" && second.page.view.sourceRevision, 1);
  assert.equal(second.kind === "page" && second.page.currentHead.revision, 2);

  const treeFirst = await pages.treePage({
    conversationId: "conv_page",
    sourceRevision: 1,
    pageSize: 2,
  });
  assert.equal(treeFirst.kind, "page");
  assert.deepEqual(
    treeFirst.kind === "page"
      ? treeFirst.page.entries.map((entry) => entry.entryId)
      : [],
    ["entry_1", "entry_2"],
  );
  const treeSecond = await reopenedPages.treePage({
    conversationId: "conv_page",
    pageSize: 2,
    cursor: treeFirst.kind === "page" ? treeFirst.page.nextCursor : undefined,
  });
  assert.equal(treeSecond.kind, "page");
  assert.deepEqual(
    treeSecond.kind === "page"
      ? treeSecond.page.entries.map((entry) => entry.entryId)
      : [],
    ["entry_3", "entry_4"],
  );
  assert.equal(
    treeSecond.kind === "page" && treeSecond.page.view.sourceRevision,
    1,
  );
  assert.equal(
    treeSecond.kind === "page" && treeSecond.page.currentHead.revision,
    2,
  );
  const [caughtUp] = await projections.rebuildPending(
    10,
    "2026-09-12T00:00:02.000Z",
  );
  assert.equal(caughtUp?.appliedRevision, 2);
  assert.equal(caughtUp?.rebuildGeneration, 2);
  const invalidatedByRebuild = await pages.page({
    conversationId: "conv_page",
    cursor: first.kind === "page" ? first.page.nextCursor : undefined,
  });
  assert.equal(invalidatedByRebuild.kind, "reconciliation_required");
  assert.equal(
    invalidatedByRebuild.kind === "reconciliation_required" &&
      invalidatedByRebuild.reason,
    "projection_rebuilt",
  );
});
